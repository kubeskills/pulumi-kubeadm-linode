# Create Kubeadm Cluster on Linode with Pulumi

This Pulumi program provisions two Linode instances (or a configurable count) and bootstraps each node with `kubectl`, `kubeadm`, and `kubelet` using cloud-init. The instances are ready to be joined into a kubeadm-managed Kubernetes cluster once provisioning completes.

## Prerequisites
- Pulumi CLI configured with Linode access token (`linode:token` config).
- Node.js 18+ and npm.
- An SSH key pair whose public key you can authorize on each instance.

## Setup
```bash
npm install
pulumi stack init kubeadm-dev  # or reuse an existing stack
pulumi config set linode:token <your-linode-token> --secret
pulumi config set sshPublicKey "$(cat ~/.ssh/id_rsa.pub)"
# Optional overrides
pulumi config set region us-east
pulumi config set instanceType g6-standard-2
pulumi config set nodeCount 2
```

## Deploy
```bash
pulumi up
```

Exports include Linode instance IDs, public IPs, and private IPs for the nodes.

## Cleanup
When you are finished, remove the resources with:
```bash
pulumi destroy
```
