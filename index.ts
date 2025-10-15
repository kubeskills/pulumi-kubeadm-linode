import * as pulumi from "@pulumi/pulumi";
import * as linode from "@pulumi/linode";
import * as random from "@pulumi/random";
import * as command from "@pulumi/command";

const config = new pulumi.Config();
const region = config.get("region") ?? "us-east";
const instanceType = config.get("instanceType") ?? "g6-standard-2";
const image = config.get("image") ?? "linode/ubuntu22.04";
const sshPublicKey = config.require("sshPublicKey");
const sshPrivateKey = config.requireSecret("sshPrivateKey");
const sshUser = config.get("sshUser") ?? "root";
const nodeCount = config.getNumber("nodeCount") ?? 2;

const existingVpcId = config.getNumber("existingVpcId");
const existingVpcSubnetId = config.getNumber("existingVpcSubnetId");

if ((existingVpcId === undefined) !== (existingVpcSubnetId === undefined)) {
    throw new Error(
        "Both existingVpcId and existingVpcSubnetId must be provided together to use an existing VPC.",
    );
}

let targetVpcId: pulumi.Output<number>;
let targetVpcSubnetId: pulumi.Output<number>;
let kubeVpc: linode.Vpc | undefined;
let kubeVpcSubnet: linode.VpcSubnet | undefined;

if (existingVpcId !== undefined && existingVpcSubnetId !== undefined) {
    targetVpcId = pulumi.output(existingVpcId);
    targetVpcSubnetId = pulumi.output(existingVpcSubnetId);
} else {
    const stack = pulumi.getStack();
    const sanitizeLabel = (label: string, fallback: string) => {
        const sanitized = label
            .replace(/[^a-zA-Z0-9-]/g, "-")
            .replace(/-+/g, "-")
            .replace(/^-+/, "")
            .replace(/-+$/, "");
        return sanitized.length > 0 ? sanitized : fallback;
    };

    const vpcLabel =
        config.get("vpcLabel") ?? sanitizeLabel(`kubeadm-vpc-${stack}`, "kubeadm-vpc");
    const vpcSubnetLabel =
        config.get("vpcSubnetLabel") ?? sanitizeLabel(`kubeadm-subnet-${stack}`, "kubeadm-subnet");
    const vpcSubnetCidr = config.get("vpcSubnetCidr") ?? "10.0.0.0/24";

    kubeVpc = new linode.Vpc("cluster-vpc", {
        label: vpcLabel,
        region,
        description: "Pulumi-managed VPC for kubeadm nodes",
    });

    targetVpcId = kubeVpc.id.apply((id) => parseInt(id, 10));

    kubeVpcSubnet = new linode.VpcSubnet("cluster-subnet", {
        vpcId: targetVpcId,
        label: vpcSubnetLabel,
        ipv4: vpcSubnetCidr,
    });

    targetVpcSubnetId = kubeVpcSubnet.id.apply((id) => parseInt(id, 10));
}

const rootPassword = new random.RandomPassword("linode-root-password", {
    length: 20,
    minLower: 1,
    minUpper: 1,
    minNumeric: 1,
    minSpecial: 1,
    overrideSpecial: "!@#$%^&*()-_=+[]{}<>?",
});
const rootPasswordSecret = pulumi.secret(rootPassword.result);

const nodes: linode.Instance[] = [];
const hostnames: string[] = [];

for (let i = 0; i < nodeCount; i++) {
    const hostname =
        i === 0 ? "controlplane" : i === 1 ? "worker" : `worker-${i}`;
    hostnames.push(hostname);

    nodes.push(
        new linode.Instance(`kube-node-${i + 1}`, {
            label: `kube-node-${i + 1}`,
            region,
            type: instanceType,
            image,
            rootPass: rootPasswordSecret,
            authorizedKeys: [sshPublicKey],
            privateIp: true,
            tags: ["pulumi", "kubeadm"],
            interfaces: [
                {
                    purpose: "public",
                    primary: true,
                },
                {
                    purpose: "vpc",
                    subnetId: targetVpcSubnetId,
                },
            ],
        }),
    );
}

const bootstrapResources: command.remote.Command[] = nodes.map((node, index) => {
    const hostname = hostnames[index];
    const bootstrapScript = pulumi.interpolate`
set -euxo pipefail
hostnamectl set-hostname ${hostname}
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y apt-transport-https ca-certificates curl gpg
mkdir -p /etc/apt/keyrings
curl -fsSL https://pkgs.k8s.io/core:/stable:/v1.28/deb/Release.key | gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg
echo 'deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v1.28/deb/ /' > /etc/apt/sources.list.d/kubernetes.list
apt-get update
apt-get install -y kubelet kubeadm kubectl
apt-mark hold kubelet kubeadm kubectl
systemctl enable kubelet
swapoff -a || true
`;

    return new command.remote.Command(`bootstrap-${index + 1}`, {
        connection: {
            host: node.ipAddress,
            user: sshUser,
            privateKey: sshPrivateKey,
            dialErrorLimit: 30,
        },
        create: bootstrapScript,
        triggers: [
            pulumi.interpolate`${hostname}-k8s-bootstrap`,
            bootstrapScript,
        ],
    }, { dependsOn: node });
});

interface NodeDetails {
    hostname: string;
    id: string;
    publicIp: string;
    privateIp: string;
}

const nodeDetailsOutputs: pulumi.Output<NodeDetails>[] = nodes.map((node, index) =>
    pulumi
        .all([node.id, node.ipAddress, node.privateIpAddress])
        .apply(([id, publicIp, privateIp]) => ({
            hostname: hostnames[index],
            id,
            publicIp,
            privateIp,
        })),
);

const nodeDetailsAll = pulumi.all(nodeDetailsOutputs);

export const nodeDetails = nodeDetailsAll;

export const instanceIds = nodeDetailsAll.apply((details) =>
    details.map((detail) => detail.id),
);

export const publicIps = nodeDetailsAll.apply((details) =>
    details.map((detail) => ({
        hostname: detail.hostname,
        ip: detail.publicIp,
    })),
);

export const privateIps = nodeDetailsAll.apply((details) =>
    details.map((detail) => ({
        hostname: detail.hostname,
        ip: detail.privateIp,
    })),
);

export const controlplanePublicIp = nodeDetailsAll.apply((details) =>
    details.find((d) => d.hostname === "controlplane")?.publicIp,
);

export const workerPublicIp = nodeDetailsAll.apply((details) =>
    details.find((d) => d.hostname === "worker")?.publicIp,
);

export const vpcId = targetVpcId;
export const vpcSubnetId = targetVpcSubnetId;
