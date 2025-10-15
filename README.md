# Create Kubeadm Cluster on Linode with Pulumi

This Pulumi program provisions two Linode instances (or a configurable count) inside a Linode VPC. After the infrastructure is created, run the included Ansible playbook to install and hold `kubectl`, `kubeadm`, and `kubelet`, leaving each node ready for a kubeadm-managed Kubernetes cluster.

## Prerequisites
- Pulumi CLI configured with Linode access token (`linode:token` config).
- Node.js 18+ and npm.
- An SSH key pair whose public key you can authorize on each instance (for connecting via Ansible).
- Ansible 2.14+ (or later) for post-provision configuration.

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

Exports include Linode instance IDs, public IPs, and private IPs (all labeled by hostname), along with the VPC and subnet identifiers. The `ansibleInventoryLines` export prints helper lines (`hostname ansible_host=IP`) you can paste into an Ansible inventory file.

When `existingVpcId` and `existingVpcSubnetId` are supplied, the stack attaches the instances to that network instead of creating a new VPC.

After `pulumi up`, configure the nodes with Ansible using the playbook at `ansible/playbook.yml`:

```bash
# Example: capture inventory lines into a file
pulumi stack output ansibleInventoryLines --json | jq -r '.[]' > inventory.ini

# Edit inventory.ini to group hosts, optionally supplying desired hostnames
[kube_nodes]
controlplane ansible_host=198.51.100.10 node_hostname=controlplane
worker ansible_host=198.51.100.11 node_hostname=worker

# Run the playbook (assumes your SSH key matches the authorized key configured above)
ansible-playbook -i inventory.ini ansible/playbook.yml
```

The playbook installs Kubernetes components, holds their versions, enables the kubelet, optionally sets a hostname when `node_hostname` is provided, and disables swap.

## Cleanup
When you are finished, remove the resources with:
```bash
pulumi destroy
```
