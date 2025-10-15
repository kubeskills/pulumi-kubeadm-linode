import * as pulumi from "@pulumi/pulumi";
import * as linode from "@pulumi/linode";
import * as random from "@pulumi/random";

const config = new pulumi.Config();
const region = config.get("region") ?? "us-east";
const instanceType = config.get("instanceType") ?? "g6-standard-2";
const image = config.get("image") ?? "linode/ubuntu22.04";
const sshPublicKey = config.require("sshPublicKey");
const nodeCount = config.getNumber("nodeCount") ?? 2;

const rootPassword = new random.RandomPassword("linode-root-password", {
    length: 20,
    minLower: 1,
    minUpper: 1,
    minNumeric: 1,
    minSpecial: 1,
    overrideSpecial: "!@#$%^&*()-_=+[]{}<>?",
});

const createUserData = (hostname: string): string => {
    const bootstrapScriptLines = [
        "#!/bin/bash",
        "set -euxo pipefail",
        `hostnamectl set-hostname ${hostname}`,
        "export DEBIAN_FRONTEND=noninteractive",
        "apt-get update",
        "apt-get install -y apt-transport-https ca-certificates curl gpg",
        "mkdir -p /etc/apt/keyrings",
        "curl -fsSL https://pkgs.k8s.io/core:/stable:/v1.28/deb/Release.key | gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg",
        "echo 'deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v1.28/deb/ /' > /etc/apt/sources.list.d/kubernetes.list",
        "apt-get update",
        "apt-get install -y kubelet kubeadm kubectl",
        "apt-mark hold kubelet kubeadm kubectl",
        "systemctl enable kubelet",
        "swapoff -a || true",
    ];

    const cloudInit = `#cloud-config
package_update: true
package_upgrade: true
write_files:
  - path: /usr/local/bin/bootstrap-kubernetes.sh
    owner: root:root
    permissions: '0755'
    content: |
${bootstrapScriptLines.map((line) => `      ${line}`).join("\n")}
runcmd:
  - ["/usr/local/bin/bootstrap-kubernetes.sh"]
`;

    return Buffer.from(cloudInit).toString("base64");
};

const nodes: linode.Instance[] = [];

for (let i = 0; i < nodeCount; i++) {
    const hostname = i === 0 ? "controlplane" : "worker";
    const userDataBase64 = createUserData(hostname);

    nodes.push(
        new linode.Instance(`kube-node-${i + 1}`, {
            label: `kube-node-${i + 1}`,
            region,
            type: instanceType,
            image,
            rootPass: rootPassword.result,
            authorizedKeys: [sshPublicKey],
            privateIp: true,
            tags: ["pulumi", "kubeadm"],
            metadata: {
                userData: userDataBase64,
            },
        }),
    );
}

export const instanceIds = nodes.map((node) => node.id);
export const publicIps = nodes.map((node) => node.ipAddress);
export const privateIps = nodes.map((node) => node.privateIpAddress);
