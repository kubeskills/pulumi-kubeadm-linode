# Create Kubeadm Cluster on Linode with Pulumi

This Pulumi program provisions two Linode instances (or a configurable count) inside a Linode VPC and bootstraps each node with `kubectl`, `kubeadm`, and `kubelet` by running a remote configuration script over SSH. The instances are ready to be joined into a kubeadm-managed Kubernetes cluster once provisioning completes.

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
pulumi config set vpcLabel kubeadm-vpc
pulumi config set vpcSubnetLabel kubeadm-subnet
pulumi config set vpcSubnetCidr 10.0.0.0/24
# Or target an existing VPC and subnet (numeric IDs from the Linode API/Cloud Manager)
pulumi config set existingVpcId 123456
pulumi config set existingVpcSubnetId 654321
```

## Deploy
```bash
pulumi up
```

Exports include Linode instance IDs, public IPs, and private IPs (all labeled by hostname), along with the VPC and subnet identifiers.
Public IPs are labeled with their hostnames (`controlplane`, `worker`) for easy identification after `pulumi up`.

When `existingVpcId` and `existingVpcSubnetId` are supplied, the stack attaches the instances to that network instead of creating a new VPC.

Each instance is configured immediately after provisioning via the Pulumi Command provider—`hostnamectl` sets the hostname, Kubernetes apt repositories are added, and `kubeadm`, `kubelet`, and `kubectl` are installed and held to the current version.

## Cleanup
When you are finished, remove the resources with:
```bash
pulumi destroy
```
