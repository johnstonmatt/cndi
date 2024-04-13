

cndi


       
Start with a Template for a popular service like Airflow or PostgreSQL and CNDI will help you deploy it on your own infrastructure - just as easily as you can sign up for a cloud-based Platform as a Service.
You can also develop your own Templates to provide fill-in-the-blanks style wizards to your team.
Once your cluster is set up, manage the infrastructure and applications with ease using GitOps and Infrastructure as Code.
demo video 🎥
If you'd like to see a walkthrough for setting up an Airflow cluster using CNDI, checkout this demo:

installation 🥁
To install CNDI you just need to download the "tarball" for your system from GitHub Releases and extract it to disk. This script automates that job:
curl -fsSL https://raw.githubusercontent.com/polyseam/cndi/main/install.sh | sh
If you run into trouble or if you want to install the Windows executable, check out our tiny install guide.
usage 👩‍💻
CNDI is a tool with which to deploy GitOps enabled Kubernetes application clusters on any platform as quickly and easily as possible. Every CNDI project starts with a Template.
create  🚀
The best way to bootstrap a CNDI project is by using cndi create. It's best because it is easy and interactive, to some folks it may even feel like too much magic 🪄 but fear not! We will explain everything soon. 

We start by picking a CNDI Template, and airflow is one of our favourites.
Let's run with that:
# cndi create johnstonmatt/my-airflow --template airflow && cd my-airflow
cndi create <owner>/<repo> -t airflow && cd <repo>
Airflow is one of the templates bundled with CNDI, so we can call it out by name, but Templates are just YAML, so they can also be loaded from a URL or file path!

The first prompt asks where you want to store your project on disk, defaulting to a new folder called <repo> in the current directory.
There will be a few more prompts that are asked for every new CNDI project, including asking for GitHub credentials, which CNDI Template you want to use, and where you want to deploy your new cluster.
These prompts are called core prompts, and depending how you answer that first set, you'll be shown more prompts. One of the more important decisions is to choose your cloud provider and cndi natively supports 4 today: aws, gcp, azure, and dev for deploying experiments locally.
CNDI shines brightest when deploying to the cloud, so we encourage that if you have access!
The last set of questions relate directly to the Template you selected, and generally it is fine to accept the defaults if you aren't completely familiar with the stack you are deploying.
Once you've answered all of the prompts, CNDI will create a number of project files we call outputs.
We have a dedicated section that covers outputs, but there a couple things that are important to know now:
cndi create will create a GitHub repo on your behalf and push the code (outputs) it generates for you to that repo
All of your responses that are sensitive are written to a .env file, and that file will not be included in your repo. Instead, CNDI will push these to GitHub for use in automation by using the  GitHub Secrets API.
CNDI created a file called .github/workflows/cndi-run.yaml which will trigger any time code is pushed to your repo
The CLI will provide info about the files it is creating for you, then provide a link to the new repo where you can watch the GitHub Action deployment progress! 

overwrite ♻️
After a Template has been initialized with either cndi init or cndi create , CNDI projects are managed from only 2 files:


.env:  adheres to the dotenv pattern, its .gitignored, it contains all secret values which must not be included in source control
cndi_config.yaml: this file is the center of your cndi project, it provides an abstraction which unifies infrastructure, applications, and configuration

Though these files are the only ones required to manage your project as a user, they are not natively understood by Infrastructure as Code tools, and they are not understood by Kubernetes natively either. 

You manage your cluster using cndi_config.yaml, but you must transform it into code that can be processed by Terraform, and manifests which can be processed by Kubernetes through ArgoCD.

The cndi overwrite command is responsible for taking both your .env file and your cndi_config.yaml file and transforming them into a set of Kubernetes manifests, and Terraform objects.
The cndi_config.yaml file is structured into 4 main sections:
metadata - eg. project_name, cndi_version,  provider, distribution
applications - used to define Helm Charts which should be installed and configured
cluster_manifests - used for arbitrary Kubernetes configuration
infrastructure - used to define infrastructure cndi exposes and optionally raw Terraform objects
The workflow is simple, modify your cndi_config.yaml fields and call cndi ow , it will transform your configuration into files which can be processed by ArgoCD and Terraform, and it will output the resulting files to the ./cndi folder at the root of your repo.

Feel free to examine the result of calling cndi ow to better understand how it works. This can be especially insightful when examining a git diff,  but remember, those files are for machines and you can be productive with CNDI without ever reading or understanding them - that's by design.

run 🌥️
Once you've made changes using cndi ow, the next step is to git push a commit so that those changes to infrastructure and applications can be applied. The .github/workflows/cndi-run.yaml file we've generated for you is very simple.
The workflow checks to ensure there is no active instance of the workflow in progress to prevent corruption, it loads the credentials which are required for the deployment of infrastructure, and then it calls cndi run.
The run command is responsible for calling Terraform against all of the objects in the ./cndi/terraform/ folder, then encrypting and persisting Terraform state in git.
Calling cndi run doesn't do anything directly with the other half of your config ./cndi/cluster_manifests, and that is because those manifests are instead pulled into your cluster by ArgoCD when it has been successfully deployed by Terraform.

destroy 🗑️
The last cndi command you should know about is cndi destroy. This command takes no arguments, and it is responsible for pulling and decrypting Terraform state, then calling terraform destroy for you under the hood, which will blast away every resource that cndi has created. Once the command exits successfully, you can safely delete your git repo or achive it for reference later.

Walkthroughs 🥾
We've got a few walkthroughs you can follow if you'd like, one for each deployment target. These walkthroughs hold your hand through the process of deploying Airflow to the provider and distribution of your choice. They include info about how to get credentials, explanations about prompts, screenshots, and more.
ec2/airflow - AWS EC2
eks/airflow - AWS EKS
gce/airflow - GCP Compute Engine
gke/airflow - GCP GKE
avm/airflow - Azure Virtual Machines
aks/airflow - Azure AKS
dev/airflow - Local Development
If you are interested in using CNDI, these walkthroughs will be entirely transferrable to other applications beyond Airflow!

configuration 📝
If you understand a cndi_config.yaml file, you will be successful in using CNDI. The file enables configuring existing systems like cert-manager for TLS certs, external-dns, and ingress. It also enables adding arbitrary Kubernetes Manifests and Terraform objects, yielding endless possibilities. To learn about all the configuration options, check out the CNDI Config Guide and accompanying jsonschema file.
outputs 📂
There are a few other files beyond cndi_config.yaml which all play a part in your cndi project. To learn more about each file cndi create generated, check out CNDI Outputs Guide.
up and running 🏃
Once you have a cluster and know the basics, how can you make the most of it? For a guide focused on operating a cndi cluster and suppporting it over time, check out Up and Running with CNDI Guide.
building cndi 🛠️
If you're hoping to contribute to cndi, please reach out to johnstonmatt! To learn more about setting up your development environment and other contributor info, check out CNDI Contributor Guide.
getting help ❤️
CNDI is in active development and there may be bugs, rough edges, or missing docs. We are commited to help you succeed with the project. If you need help reach out however you can.
We aim to maintain a discussion post for every possible exception here, so those are a great place to start, but don't hesitate to create an issue if you aren't able to find a discussion thread for your error.

We'd love to see you in the Polyseam Discord Channel too, for help or just to hang out.
