"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var _a, _b, _c, _d, _e, _f, _g;
Object.defineProperty(exports, "__esModule", { value: true });
exports.vpcSubnetId = exports.vpcId = exports.workerPublicIp = exports.controlplanePublicIp = exports.privateIps = exports.publicIps = exports.instanceIds = exports.nodeDetails = void 0;
const pulumi = __importStar(require("@pulumi/pulumi"));
const linode = __importStar(require("@pulumi/linode"));
const random = __importStar(require("@pulumi/random"));
const config = new pulumi.Config();
const region = (_a = config.get("region")) !== null && _a !== void 0 ? _a : "us-east";
const instanceType = (_b = config.get("instanceType")) !== null && _b !== void 0 ? _b : "g6-standard-2";
const image = (_c = config.get("image")) !== null && _c !== void 0 ? _c : "linode/ubuntu22.04";
const sshPublicKey = config.require("sshPublicKey");
const nodeCount = (_d = config.getNumber("nodeCount")) !== null && _d !== void 0 ? _d : 2;
const existingVpcId = config.getNumber("existingVpcId");
const existingVpcSubnetId = config.getNumber("existingVpcSubnetId");
if ((existingVpcId === undefined) !== (existingVpcSubnetId === undefined)) {
    throw new Error("Both existingVpcId and existingVpcSubnetId must be provided together to use an existing VPC.");
}
let targetVpcId;
let targetVpcSubnetId;
let kubeVpc;
let kubeVpcSubnet;
if (existingVpcId !== undefined && existingVpcSubnetId !== undefined) {
    targetVpcId = pulumi.output(existingVpcId);
    targetVpcSubnetId = pulumi.output(existingVpcSubnetId);
}
else {
    const stack = pulumi.getStack();
    const sanitizeLabel = (label, fallback) => {
        const sanitized = label
            .replace(/[^a-zA-Z0-9-]/g, "-")
            .replace(/-+/g, "-")
            .replace(/^-+/, "")
            .replace(/-+$/, "");
        return sanitized.length > 0 ? sanitized : fallback;
    };
    const vpcLabel = (_e = config.get("vpcLabel")) !== null && _e !== void 0 ? _e : sanitizeLabel(`kubeadm-vpc-${stack}`, "kubeadm-vpc");
    const vpcSubnetLabel = (_f = config.get("vpcSubnetLabel")) !== null && _f !== void 0 ? _f : sanitizeLabel(`kubeadm-subnet-${stack}`, "kubeadm-subnet");
    const vpcSubnetCidr = (_g = config.get("vpcSubnetCidr")) !== null && _g !== void 0 ? _g : "10.0.0.0/24";
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
const createUserData = (hostname) => {
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
const nodes = [];
const hostnames = [];
for (let i = 0; i < nodeCount; i++) {
    const hostname = i === 0 ? "controlplane" : i === 1 ? "worker" : `worker-${i}`;
    hostnames.push(hostname);
    const userDataBase64 = createUserData(hostname);
    nodes.push(new linode.Instance(`kube-node-${i + 1}`, {
        label: `kube-node-${i + 1}`,
        region,
        type: instanceType,
        image,
        rootPass: rootPassword.result,
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
        metadatas: [
            {
                userData: userDataBase64,
            },
        ],
    }));
}
const nodeDetailsOutputs = nodes.map((node, index) => pulumi
    .all([node.id, node.ipAddress, node.privateIpAddress])
    .apply(([id, publicIp, privateIp]) => ({
    hostname: hostnames[index],
    id,
    publicIp,
    privateIp,
})));
const nodeDetailsAll = pulumi.all(nodeDetailsOutputs);
exports.nodeDetails = nodeDetailsAll;
exports.instanceIds = nodeDetailsAll.apply((details) => details.map((detail) => detail.id));
exports.publicIps = nodeDetailsAll.apply((details) => details.map((detail) => ({
    hostname: detail.hostname,
    ip: detail.publicIp,
})));
exports.privateIps = nodeDetailsAll.apply((details) => details.map((detail) => ({
    hostname: detail.hostname,
    ip: detail.privateIp,
})));
exports.controlplanePublicIp = nodeDetailsAll.apply((details) => { var _a; return (_a = details.find((d) => d.hostname === "controlplane")) === null || _a === void 0 ? void 0 : _a.publicIp; });
exports.workerPublicIp = nodeDetailsAll.apply((details) => { var _a; return (_a = details.find((d) => d.hostname === "worker")) === null || _a === void 0 ? void 0 : _a.publicIp; });
exports.vpcId = targetVpcId;
exports.vpcSubnetId = targetVpcSubnetId;
