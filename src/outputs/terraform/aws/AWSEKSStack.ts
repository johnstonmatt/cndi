import { CNDIConfig } from "src/types.ts";
import {
  DEFAULT_INSTANCE_TYPES,
  DEFAULT_NODE_DISK_SIZE_MANAGED,
  KUBESEAL_VERSION,
  RELOADER_VERSION,
} from "consts";
import {
  App,
  CDKTFProviderAWS,
  CDKTFProviderHelm,
  CDKTFProviderKubernetes,
  CDKTFProviderTime,
  CDKTFProviderTls,
  Construct,
  Fn,
  TerraformOutput,
} from "deps";

import {
  getCDKTFAppConfig,
  getPrettyJSONString,
  resolveCNDIPorts,
  stageCDKTFStack,
  useSshRepoAuth,
} from "src/utils.ts";

import AWSCoreTerraformStack from "./AWSCoreStack.ts";

// TODO: ensure that splicing project_name into tags.Name is safe
export default class AWSEKSTerraformStack extends AWSCoreTerraformStack {
  constructor(scope: Construct, name: string, cndi_config: CNDIConfig) {
    super(scope, name, cndi_config);
    const project_name = this.locals.cndi_project_name.asString;
    const open_ports = resolveCNDIPorts(cndi_config);

    new CDKTFProviderTime.provider.TimeProvider(this, "time", {});
    new CDKTFProviderTls.provider.TlsProvider(this, "tls", {});

    const vpc = new CDKTFProviderAWS.vpc.Vpc(this, "cndi_aws_vpc", {
      cidrBlock: "10.0.0.0/16",
      enableDnsHostnames: true,
      enableDnsSupport: true,
      tags: {
        Name: `CNDIVPC_${project_name}`,
        [`kubernetes.io/cluster/${project_name}`]: "owned",
      },
    });

    const igw = new CDKTFProviderAWS.internetGateway.InternetGateway(
      this,
      "cndi_aws_internet_gateway",
      {
        vpcId: vpc.id,
        tags: {
          Name: `CNDIInternetGateway_${project_name}`,
        },
      },
    );

    const eip = new CDKTFProviderAWS.eip.Eip(this, "cndi_aws_eip", {
      vpc: true,
      tags: {
        Name: `CNDIElasticIP_${project_name}`,
      },
      dependsOn: [igw],
    });

    new CDKTFProviderAWS.dataAwsCallerIdentity.DataAwsCallerIdentity(
      this,
      "cndi_aws_caller_identity",
      {},
    );

    // TODO: should this be further filtered according to instance_type avaiability?
    const availabilityZones = new CDKTFProviderAWS.dataAwsAvailabilityZones
      .DataAwsAvailabilityZones(
      this,
      "available-zones",
      {
        state: "available",
      },
    );

    const securityGroupIngresses = [
      {
        cidrBlocks: ["10.0.0.0/16"],
        description:
          "Inbound rule that enables traffic between EC2 instances in the VPC ",
        fromPort: 0,
        ipv6CidrBlocks: [],
        prefixListIds: [],
        protocol: "-1",
        securityGroups: [],
        self: false,
        toPort: 0,
      },
    ];

    open_ports.forEach((port) => {
      securityGroupIngresses.push({
        cidrBlocks: ["0.0.0.0/0"],
        description: `Port for ${port.name} traffic`,
        fromPort: port.number,
        ipv6CidrBlocks: [],
        prefixListIds: [],
        protocol: "tcp",
        securityGroups: [],
        self: false,
        toPort: port.number,
      });
    });

    const securityGroup = new CDKTFProviderAWS.securityGroup.SecurityGroup(
      this,
      `cndi_aws_security_group`,
      {
        description: "Security firewall",
        vpcId: vpc.id,
        ingress: securityGroupIngresses,
        egress: [
          {
            cidrBlocks: ["0.0.0.0/0"],
            description: "All traffic",
            fromPort: 0,
            ipv6CidrBlocks: [],
            prefixListIds: [],
            protocol: "-1",
            securityGroups: [],
            toPort: 0,
          },
        ],
        tags: {
          Name: `CNDISecurityGroup_${project_name}`,
        },
      },
    );

    const subnetPrivateA = new CDKTFProviderAWS.subnet.Subnet(
      this,
      "cndi_aws_subnet_private_a",
      {
        availabilityZone: Fn.element(availabilityZones.names, 0),
        cidrBlock: "10.0.3.0/24",
        mapPublicIpOnLaunch: true,
        tags: {
          Name: `CNDIPrivateSubnetA_${project_name}`,
          [`kubernetes.io/cluster/${project_name}`]: "owned",
          "kubernetes.io/role/internal-elb": "1",
        },
        vpcId: vpc.id,
      },
    );

    const subnetPrivateB = new CDKTFProviderAWS.subnet.Subnet(
      this,
      "cndi_aws_subnet_private_b",
      {
        availabilityZone: Fn.element(availabilityZones.names, 1),
        cidrBlock: "10.0.4.0/24",
        mapPublicIpOnLaunch: true,
        tags: {
          Name: `PrivateSubnetB_${project_name}`,
          [`kubernetes.io/cluster/${project_name}`]: "owned",
          "kubernetes.io/role/internal-elb": "1",
        },
        vpcId: vpc.id,
      },
    );

    const subnetPublicA = new CDKTFProviderAWS.subnet.Subnet(
      this,
      "cndi_aws_subnet_public_a",
      {
        availabilityZone: Fn.element(availabilityZones.names, 0),
        cidrBlock: "10.0.1.0/24",
        mapPublicIpOnLaunch: true,
        tags: {
          Name: `PublicSubnetA_${project_name}`,
          [`kubernetes.io/cluster/${project_name}`]: "owned",
          "kubernetes.io/role/elb": "1",
        },
        vpcId: vpc.id,
      },
    );

    const efsFs = new CDKTFProviderAWS.efsFileSystem.EfsFileSystem(
      this,
      "cndi_aws_efs_file_system",
      {
        creationToken: `cndi_aws_efs_token_for_${project_name}`,
        tags: {
          Name: `ElasticFileSystem_${project_name}`,
        },
      },
    );

    const _efsAccessPoint = new CDKTFProviderAWS.efsAccessPoint.EfsAccessPoint(
      this,
      "cndi_aws_efs_access_point",
      {
        fileSystemId: efsFs.id,
        tags: {
          Name: `ElasticFileSystemAccessPoint_${project_name}`,
        },
      },
    );

    const _efsMountTargetA = new CDKTFProviderAWS.efsMountTarget.EfsMountTarget(
      this,
      "cndi_aws_efs_mount_target",
      {
        fileSystemId: efsFs.id,
        securityGroups: [securityGroup.id],
        subnetId: subnetPrivateA.id,
      },
    );

    const computePolicy = new CDKTFProviderAWS.dataAwsIamPolicyDocument
      .DataAwsIamPolicyDocument(
      this,
      "cndi_aws_iam_policy_document_eks_ec2",
      {
        statement: [
          {
            actions: ["sts:AssumeRole"],
            effect: "Allow",
            principals: [
              {
                identifiers: ["eks.amazonaws.com"],
                type: "Service",
              },
              {
                identifiers: ["ec2.amazonaws.com"],
                type: "Service",
              },
            ],
          },
        ],
      },
    );

    const computeRole = new CDKTFProviderAWS.iamRole.IamRole(
      this,
      "cndi_aws_iam_role_eks_ec2",
      {
        namePrefix: "EC2EKS",
        assumeRolePolicy: computePolicy.json,
      },
    );

    const natGateway = new CDKTFProviderAWS.natGateway.NatGateway(
      this,
      "cndi_aws_nat_gateway",
      {
        allocationId: eip.id,
        dependsOn: [igw],
        subnetId: subnetPublicA.id,
        tags: {
          Name: `NATGateway_${project_name}`,
        },
      },
    );

    const publicRouteTable = new CDKTFProviderAWS.routeTable.RouteTable(
      this,
      "cndi_aws_route_table_public",
      {
        tags: {
          Name: `RouteTablePublic_${project_name}`,
        },
        vpcId: vpc.id,
      },
    );

    const _publicRoute = new CDKTFProviderAWS.route.Route(
      this,
      "cndi_aws_route_public",
      {
        routeTableId: publicRouteTable.id,
        destinationCidrBlock: "0.0.0.0/0",
        gatewayId: igw.id,
      },
    );

    const privateRouteTable = new CDKTFProviderAWS.routeTable.RouteTable(
      this,
      "cndi_aws_route_table_private",
      {
        tags: {
          Name: `RouteTablePrivate_${project_name}`,
        },
        vpcId: vpc.id,
      },
    );

    const _privateRoute = new CDKTFProviderAWS.route.Route(
      this,
      "cndi_aws_route_private",
      {
        routeTableId: privateRouteTable.id,
        destinationCidrBlock: "0.0.0.0/0",
        natGatewayId: natGateway.id,
      },
    );

    const clusterPolicyAttachment = new CDKTFProviderAWS.iamRolePolicyAttachment
      .IamRolePolicyAttachment(
      this,
      "cndi_aws_iam_role_policy_attachment_eks_cluster_policy",
      {
        role: computeRole.name,
        policyArn: "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy",
      },
    );

    const servicePolicyAttachment = new CDKTFProviderAWS.iamRolePolicyAttachment
      .IamRolePolicyAttachment(
      this,
      "cndi_aws_iam_role_policy_attachment_eks_service_policy",
      {
        policyArn: "arn:aws:iam::aws:policy/AmazonEKSServicePolicy",
        role: computeRole.name,
      },
    );

    const workerNodePolicyAttachment = new CDKTFProviderAWS
      .iamRolePolicyAttachment.IamRolePolicyAttachment(
      this,
      "cndi_aws_iam_role_policy_attachment_eks_worker_node_policy",
      {
        policyArn: "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy",
        role: computeRole.name,
      },
    );

    const cniPolicyAttachment = new CDKTFProviderAWS.iamRolePolicyAttachment
      .IamRolePolicyAttachment(
      this,
      "cndi_aws_iam_role_policy_attachment_eks_cni_policy",
      {
        policyArn: "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy",
        role: computeRole.name,
      },
    );

    const containerRegistryAttachment = new CDKTFProviderAWS
      .iamRolePolicyAttachment.IamRolePolicyAttachment(
      this,
      "cndi_aws_iam_role_policy_attachment_ec2_container_registry_readonly",
      {
        policyArn: "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly",
        role: computeRole.name,
      },
    );

    const _vpcAttachment = new CDKTFProviderAWS.iamRolePolicyAttachment
      .IamRolePolicyAttachment(
      this,
      "cndi_aws_iam_role_policy_attachment_eks_vpc_resource_controller",
      {
        policyArn: "arn:aws:iam::aws:policy/AmazonEKSVPCResourceController",
        role: computeRole.name,
      },
    );

    new CDKTFProviderAWS.routeTableAssociation.RouteTableAssociation(
      this,
      "cndi_aws_route_table_association_private_a",
      {
        routeTableId: privateRouteTable.id,
        subnetId: subnetPrivateA.id,
      },
    );

    new CDKTFProviderAWS.routeTableAssociation.RouteTableAssociation(
      this,
      "cndi_aws_route_table_association_private_b",
      {
        routeTableId: privateRouteTable.id,
        subnetId: subnetPrivateB.id,
      },
    );

    new CDKTFProviderAWS.routeTableAssociation.RouteTableAssociation(
      this,
      "cndi_aws_route_table_association_public_a",
      {
        routeTableId: publicRouteTable.id,
        subnetId: subnetPublicA.id,
      },
    );

    const eksCluster = new CDKTFProviderAWS.eksCluster.EksCluster(
      this,
      "cndi_aws_eks_cluster",
      {
        name: project_name!,
        roleArn: computeRole.arn,
        version: "1.25",
        vpcConfig: {
          endpointPrivateAccess: true,
          endpointPublicAccess: true,
          securityGroupIds: [securityGroup.id],
          subnetIds: [subnetPrivateA.id, subnetPrivateB.id, subnetPublicA.id],
        },
        enabledClusterLogTypes: [
          "api",
          "audit",
          "authenticator",
          "controllerManager",
          "scheduler",
        ],
        tags: {
          Name: "EKSClusterControlPlane",
          [`kubernetes.io/cluster/${project_name}`]: "owned",
        },
        dependsOn: [clusterPolicyAttachment, servicePolicyAttachment],
      },
    );

    const kubernetes = {
      clusterCaCertificate: Fn.base64decode(
        eksCluster.certificateAuthority.get(0).data,
      ),
      host: eksCluster.endpoint,
      exec: {
        apiVersion: "client.authentication.k8s.io/v1beta1",
        args: ["eks", "get-token", "--cluster-name", eksCluster.name],
        command: "aws",
      },
    };

    new CDKTFProviderKubernetes.provider.KubernetesProvider(
      this,
      "cndi_kubernetes_provider",
      kubernetes,
    );

    new CDKTFProviderHelm.provider.HelmProvider(this, "cndi_helm_provider", {
      kubernetes,
    });

    const tlsCertificate = new CDKTFProviderTls.dataTlsCertificate
      .DataTlsCertificate(
      this,
      "cndi_tls_certificate",
      {
        url: eksCluster.identity.get(0).oidc.get(0).issuer,
      },
    );

    const iamOpenIdConnectProvider = new CDKTFProviderAWS
      .iamOpenidConnectProvider.IamOpenidConnectProvider(
      this,
      "cndi_aws_iam_openid_connect_provider",
      {
        clientIdList: ["sts.amazonaws.com"],
        thumbprintList: [tlsCertificate.certificates.get(0).sha1Fingerprint],
        url: tlsCertificate.url,
      },
    );

    const webIdentityRole = new CDKTFProviderAWS.iamRole.IamRole(
      this,
      "cndi_aws_iam_role_web_identity_policy",
      {
        namePrefix: "WEBIDR",
        description: "IAM role for web identity",
        dependsOn: [iamOpenIdConnectProvider],
        assumeRolePolicy: JSON.stringify({
          Version: "2012-10-17",
          Statement: [
            {
              Action: ["sts:AssumeRoleWithWebIdentity"],
              Condition: {
                StringEquals: {
                  "system:serviceaccount:kube-system:efs-csi-controller-sa": `${
                    Fn.replace(
                      iamOpenIdConnectProvider.url,
                      "https://",
                      "",
                    )
                  }:sub`,
                  "system:serviceaccount:kube-system:ebs-csi-controller-sa": `${
                    Fn.replace(
                      iamOpenIdConnectProvider.url,
                      "https://",
                      "",
                    )
                  }:sub`,
                },
              },
              Effect: "Allow",
              Principal: {
                Federated: iamOpenIdConnectProvider.arn,
              },
            },
          ],
        }),
      },
    );

    const _webIdentityPolicy = new CDKTFProviderAWS.iamPolicy.IamPolicy(
      this,
      "cndi_aws_iam_policy_web_identity",
      {
        namePrefix: "WEBIDP",
        policy: getPrettyJSONString({
          Version: "2012-10-17",
          Statement: [
            {
              Action: [
                "autoscaling:DescribeAutoScalingGroups",
                "autoscaling:DescribeAutoScalingInstances",
                "autoscaling:DescribeLaunchConfigurations",
                "autoscaling:DescribeTags",
                "autoscaling:SetDesiredCapacity",
                "autoscaling:TerminateInstanceInAutoScalingGroup",
                "ec2:AttachVolume",
                "ec2:CreateSnapshot",
                "ec2:CreateTags",
                "ec2:CreateVolume",
                "ec2:DeleteSnapshot",
                "ec2:DeleteTags",
                "ec2:DeleteVolume",
                "ec2:DescribeInstances",
                "ec2:DescribeSnapshots",
                "ec2:DescribeTags",
                "ec2:DescribeVolumes",
                "ec2:DetachVolume",
                "elasticfilesystem:DescribeAccessPoints",
                "elasticfilesystem:DescribeFileSystems",
                "elasticfilesystem:DescribeMountTargets",
                "ec2:DescribeAvailabilityZones",
              ],
              Effect: "Allow",
              Resource: ["*"],
            },
            {
              Action: ["elasticfilesystem:CreateAccessPoint"],
              Condition: {
                StringLike: {
                  "aws:RequestTag/efs.csi.aws.com/cluster": "true",
                },
              },
              Effect: "Allow",
              Resource: ["*"],
            },
            {
              Action: ["elasticfilesystem:TagResource"],
              Condition: {
                StringLike: {
                  "aws:ResourceTag/efs.csi.aws.com/cluster": "true",
                },
              },
              Effect: "Allow",
              Resource: ["*"],
            },
            {
              Action: ["elasticfilesystem:DeleteAccessPoint"],
              Condition: {
                StringEquals: {
                  "aws:RequestTag/efs.csi.aws.com/cluster": "true",
                },
              },
              Effect: "Allow",
              Resource: ["*"],
            },
          ],
        }),
      },
    );

    let firstNodeGroup: CDKTFProviderAWS.eksNodeGroup.EksNodeGroup | null =
      null;

    for (const nodeGroup of cndi_config.infrastructure.cndi.nodes) {
      const count = nodeGroup?.count || 1;
      const maxCount = nodeGroup?.max_count;
      const minCount = nodeGroup?.min_count;
      const nodeGroupName = nodeGroup.name;

      const instanceType = nodeGroup?.instance_type ||
        DEFAULT_INSTANCE_TYPES.aws;

      const diskSize = nodeGroup?.volume_size ||
        nodeGroup?.disk_size ||
        nodeGroup?.disk_size_gb ||
        DEFAULT_NODE_DISK_SIZE_MANAGED;

      const scalingConfig = {
        desiredSize: count,
        maxSize: count,
        minSize: count,
      };

      if (maxCount) {
        scalingConfig.maxSize = maxCount;
      }
      if (minCount) {
        scalingConfig.minSize = minCount;
      }

      const ng = new CDKTFProviderAWS.eksNodeGroup.EksNodeGroup(
        this,
        "cndi_aws_eks_node_group",
        {
          clusterName: eksCluster.name,
          amiType: "AL2_x86_64",
          diskSize, // GiB
          instanceTypes: [instanceType],
          nodeGroupName,
          nodeRoleArn: computeRole.arn,
          scalingConfig,
          capacityType: "ON_DEMAND",
          subnetIds: [subnetPrivateA.id],
          updateConfig: { maxUnavailable: 1 },
          dependsOn: [
            workerNodePolicyAttachment,
            cniPolicyAttachment,
            containerRegistryAttachment,
          ],
        },
      );
      if (!firstNodeGroup) {
        firstNodeGroup = ng;
      }
    }

    const _helmReleaseEFSCSIDriver = new CDKTFProviderHelm.release.Release(
      this,
      "cndi_helm_release_aws_efs_csi_driver",
      {
        chart: "aws-efs-csi-driver",
        createNamespace: true,
        dependsOn: [efsFs],
        name: "aws-efs-csi-driver",
        namespace: "kube-system",
        repository: "https://kubernetes-sigs.github.io/aws-efs-csi-driver/",
        timeout: 600,
        atomic: true,
        set: [
          {
            name:
              "controller.serviceAccount.annotations.eks\\.amazonaws\\.com/role-arn",
            value: webIdentityRole.arn,
          },
          {
            name:
              "node.serviceAccount.annotations.eks\\.amazonaws\\.com/role-arn",
            value: webIdentityRole.arn,
          },
          { name: "storageClasses[0].name", value: "nfs" },
          { name: "storageClasses[0].provisioner", value: "efs.csi.aws.com" },
          {
            name:
              "storageClasses[0].annotations.storageclass\\.kubernetes\\.io/is-default-class",
            value: '"false"',
          },
          {
            name: "storageClasses[0].parameters.provisioningMode",
            value: "efs-ap",
          },
          {
            name: "storageClasses[0].parameters.gidRangeEnd",
            type: "string",
            value: "2000",
          },
          {
            name: "storageClasses[0].parameters.gidRangeStart",
            type: "string",
            value: "1000",
          },
          {
            name: "storageClasses[0].parameters.fileSystemId",
            value: efsFs.id,
          },
          {
            name: "storageClasses[0].parameters.directoryPerms",
            type: "string",
            value: "700",
          },
        ],
      },
    );

    const _helmReleaseNginxPrivate = new CDKTFProviderHelm.release.Release(
      this,
      "cndi_helm_release_ingress_nginx_controller_private",
      {
        chart: "ingress-nginx",
        createNamespace: true,
        dependsOn: [eksCluster, firstNodeGroup!],
        name: "ingress-nginx-private",
        namespace: "ingress-private",
        repository: "https://kubernetes.github.io/ingress-nginx",
        timeout: 300,
        atomic: true,
        set: [
          {
            name: "service.beta.kubernetes.io/aws-load-balancer-scheme",
            value: "internal",
          },
          {
            name:
              "controller.admissionWebhooks.nodeSelector\\.kubernetes\\.io/os",
            value: "linux",
          },
          {
            name:
              "controller.admissionWebhooks.patch.nodeSelector\\.kubernetes\\.io/os",
            value: "linux",
          },
          {
            name: "defaultBackend.nodeSelector\\.beta\\.kubernetes\\.io/os",
            value: "linux",
          },
          {
            name: "controller.ingressClassResource.default",
            value: "false",
          },
          {
            name: "controller.ingressClassResource.controllerValue",
            value: "k8s.io/private-nginx",
          },
          {
            name: "controller.ingressClassResource.enabled",
            value: "true",
          },
          {
            name: "controller.ingressClassResource.name",
            value: "private",
          },
          {
            name: "controller.electionID",
            value: "private-controller-leader",
          },
          {
            name: "controller.extraArgs.tcp-services-configmap",
            value: "ingress-private/ingress-nginx-private-controller",
          },
          {
            name: "rbac.create",
            value: "false",
          },
        ],
        version: "4.8.3",
      },
    );

    const helmReleaseNginxPublic = new CDKTFProviderHelm.release.Release(
      this,
      "cndi_helm_release_ingress_nginx_controller_public",
      {
        chart: "ingress-nginx",
        createNamespace: true,
        dependsOn: [eksCluster],
        name: "ingress-nginx-public",
        namespace: "ingress-public",
        repository: "https://kubernetes.github.io/ingress-nginx",
        timeout: 300,
        atomic: true,
        set: [
          {
            name: "service.beta.kubernetes.io/aws-load-balancer-type",
            value: "nlb",
          },
          {
            name:
              "controller.admissionWebhooks.nodeSelector\\.kubernetes\\.io/os",
            value: "linux",
          },
          {
            name:
              "controller.admissionWebhooks.patch.nodeSelector\\.kubernetes\\.io/os",
            value: "linux",
          },
          {
            name: "defaultBackend.nodeSelector\\.beta\\.kubernetes\\.io/os",
            value: "linux",
          },
          {
            name: "controller.ingressClassResource.default",
            value: "false",
          },
          {
            name: "controller.ingressClassResource.controllerValue",
            value: "k8s.io/public-nginx",
          },
          {
            name: "controller.ingressClassResource.enabled",
            value: "true",
          },
          {
            name: "controller.ingressClassResource.name",
            value: "public",
          },
          {
            name: "controller.electionID",
            value: "public-controller-leader",
          },
          {
            name: "controller.extraArgs.tcp-services-configmap",
            value: "ingress-public/ingress-nginx-public-controller",
          },
          {
            name: "rbac.create",
            value: "false",
          },
        ],
        version: "4.8.3",
      },
    );

    const _helmReleaseCertManager = new CDKTFProviderHelm.release.Release(
      this,
      "cndi_helm_release_cert_manager",
      {
        chart: "cert-manager",
        createNamespace: true,
        dependsOn: [firstNodeGroup!],
        name: "cert-manager",
        namespace: "cert-manager",
        repository: "https://charts.jetstack.io",
        timeout: 600,
        atomic: true,
        set: [
          {
            name: "installCRDs",
            value: "true",
          },
        ],
        version: "1.12.3",
      },
    );

    const argocdAdminPasswordHashed = Fn.sensitive(
      Fn.bcrypt(this.variables.argocd_admin_password.value, 10),
    );

    const argocdAdminPasswordMtime = new CDKTFProviderTime.staticResource
      .StaticResource(
      this,
      "cndi_time_static_argocd_admin_password",
      {
        triggers: { argocdAdminPassword: argocdAdminPasswordHashed },
      },
    );

    const helmReleaseArgoCD = new CDKTFProviderHelm.release.Release(
      this,
      "cndi_helm_release_argocd",
      {
        chart: "argo-cd",
        cleanupOnFail: true,
        createNamespace: true,
        dependsOn: [
          efsFs,
          firstNodeGroup!,
        ],
        timeout: 600,
        atomic: true,
        name: "argocd",
        namespace: "argocd",
        replace: true,
        repository: "https://argoproj.github.io/argo-helm",
        version: "5.45.0",
        set: [
          {
            name: "server.service.annotations.redeployTime",
            value: argocdAdminPasswordMtime.id,
          },
          {
            name: "configs.secret.argocdServerAdminPassword",
            value: argocdAdminPasswordHashed,
          },
          {
            name: "configs.secret.argocdServerAdminPasswordMtime",
            value: argocdAdminPasswordMtime.id,
          },
          {
            "name":
              "server.deploymentAnnotations.configmap\\.reloader\\.stakater\\.com/reload",
            "value": "argocd-cm,argocd-rbac-cm",
          },
        ],
      },
    );

    const _helmReleaseReloader = new CDKTFProviderHelm.release.Release(
      this,
      "cndi_helm_release_reloader",
      {
        chart: "reloader",
        cleanupOnFail: true,
        createNamespace: true,
        dependsOn: [eksCluster],
        timeout: 600,
        atomic: true,
        name: "reloader",
        namespace: "reloader",
        replace: true,
        repository: "https://stakater.github.io/stakater-charts",
        version: RELOADER_VERSION,
      },
    );

    if (useSshRepoAuth()) {
      new CDKTFProviderKubernetes.secret.Secret(
        this,
        "cndi_kubernetes_secret_argocd_private_repo",
        {
          dependsOn: [helmReleaseArgoCD],
          metadata: {
            name: "private-repo",
            namespace: "argocd",
            labels: {
              "argocd.argoproj.io/secret-type": "repository",
            },
          },
          data: {
            type: "git",
            url: this.variables.git_repo.value,
            sshPrivateKey: this.variables.git_ssh_private_key.value,
          },
        },
      );
    } else {
      new CDKTFProviderKubernetes.secret.Secret(
        this,
        "cndi_kubernetes_secret_argocd_private_repo",
        {
          dependsOn: [helmReleaseArgoCD],
          metadata: {
            name: "private-repo",
            namespace: "argocd",
            labels: {
              "argocd.argoproj.io/secret-type": "repository",
            },
          },
          data: {
            type: "git",
            password: this.variables.git_token.value, // this makes a reasonable case we should call it git_password as before
            username: this.variables.git_username.value,
            url: this.variables.git_repo.value,
          },
        },
      );
    }

    const sealedSecretsSecret = new CDKTFProviderKubernetes.secret.Secret(
      this,
      "cndi_kubernetes_secret_sealed_secrets_key",
      {
        type: "kubernetes.io/tls",
        metadata: {
          name: "sealed-secrets-key",
          namespace: "kube-system",
          labels: {
            "sealedsecrets.bitnami.com/sealed-secrets-key": "active",
          },
        },

        data: {
          "tls.crt": this.variables.sealed_secrets_public_key.value,
          "tls.key": this.variables.sealed_secrets_private_key.value,
        },
      },
    );

    const _helmReleaseSealedSecrets = new CDKTFProviderHelm.release.Release(
      this,
      "cndi_helm_release_sealed_secrets",
      {
        chart: "sealed-secrets",
        dependsOn: [firstNodeGroup!, sealedSecretsSecret],
        name: "sealed-secrets",
        namespace: "kube-system",
        repository: "https://bitnami-labs.github.io/sealed-secrets",
        version: KUBESEAL_VERSION,
        timeout: 300,
        atomic: true,
      },
    );

    const _helmReleaseEbsDriver = new CDKTFProviderHelm.release.Release(
      this,
      "cndi_helm_release_aws_ebs_csi_driver",
      {
        chart: "aws-ebs-csi-driver",
        createNamespace: true,
        dependsOn: [efsFs],
        name: "aws-ebs-csi-driver",
        namespace: "kube-system",
        repository: "https://kubernetes-sigs.github.io/aws-ebs-csi-driver/",
        timeout: 600,
        atomic: true,
        set: [
          {
            name:
              "controller.serviceAccount.annotations.eks\\.amazonaws\\.com/role-arn",
            value: webIdentityRole.arn,
          },
          {
            name:
              "node.serviceAccount.annotations.eks\\.amazonaws\\.com/role-arn",
            value: webIdentityRole.arn,
          },
        ],
        version: "2.22.0",
      },
    );

    const cndiNlb = new CDKTFProviderAWS.dataAwsLb.DataAwsLb(
      this,
      "cndi_aws_lb",
      {
        tags: {
          [`kubernetes.io/cluster/${project_name}`]: "owned",
        },
        dependsOn: [helmReleaseNginxPublic],
      },
    );

    const argoAppsValues = {
      applications: [
        {
          name: "root-application",
          namespace: "argocd",
          project: "default",
          finalizers: ["resources-finalizer.argocd.argoproj.io"],
          source: {
            repoURL: this.variables.git_repo.value,
            path: "cndi/cluster_manifests",
            targetRevision: "HEAD",
            directory: {
              recurse: true,
            },
          },
          destination: {
            server: "https://kubernetes.default.svc",
            namespace: "argocd",
          },
          syncPolicy: {
            automated: {
              prune: true,
              selfHeal: true,
            },
            syncOptions: ["CreateNamespace=true"],
          },
        },
      ],
    };

    new CDKTFProviderHelm.release.Release(
      this,
      "cndi_helm_release_argocd_apps",
      {
        chart: "argocd-apps",
        createNamespace: true,
        dependsOn: [helmReleaseArgoCD],
        name: "root-argo-app",
        namespace: "argocd",
        repository: "https://argoproj.github.io/argo-helm",
        version: "1.4.1",
        timeout: 600,
        atomic: true,
        values: [Fn.yamlencode(argoAppsValues)],
      },
    );

    new TerraformOutput(this, "public_host", {
      value: Fn.replace(
        cndiNlb.dnsName,
        this.locals.aws_region.asString,
        Fn.upper(this.locals.aws_region.asString),
      ),
    });

    new TerraformOutput(this, "resource_group_url", {
      value: `https://${
        Fn.upper(
          this.locals.aws_region.asString,
        )
      }.console.aws.amazon.com/resource-groups/group/CNDIResourceGroup_${project_name}?region=${
        Fn.upper(
          this.locals.aws_region.asString,
        )
      }`,
    });
  }
}

export async function stageTerraformSynthAWSEKS(cndi_config: CNDIConfig) {
  const cdktfAppConfig = await getCDKTFAppConfig();
  const app = new App(cdktfAppConfig);
  new AWSEKSTerraformStack(app, `_cndi_stack_`, cndi_config);
  await stageCDKTFStack(app);
}