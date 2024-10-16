import { ccolors, loadEnvSync, path } from "deps";
import { loadCndiConfig } from "src/utils.ts";
const setTF_VARsLabel = ccolors.faded("\nsrc/setTF_VARs.ts:");

export default async function setTF_VARs(projectDir: string) {
  let isClusterless = false;

  try {
    const { config } = await loadCndiConfig(projectDir);
    isClusterless = config.distribution === "clusterless";
  } catch (e) {
    throw e;
  }

  const envPath = path.join(projectDir, ".env");

  const envMap = loadEnvSync({ export: true, envPath });

  for (const [key, value] of Object.entries(envMap)) {
    if (key.indexOf("TF_VAR_") === 0) { // only set TF_VARs
      Deno.env.set(key, value);
    } // reserved keywords below
  }

  const git_ssh_private_key = Deno.env.get("GIT_SSH_PRIVATE_KEY");
  const git_token = Deno.env.get("GIT_TOKEN");
  const git_username = Deno.env.get("GIT_USERNAME");

  if (!git_username && !git_ssh_private_key) {
    throw new Error(
      [
        setTF_VARsLabel,
        ccolors.error("Either"),
        ccolors.key_name(`"GIT_USERNAME"`),
        ccolors.error("or"),
        ccolors.key_name(`"GIT_SSH_PRIVATE_KEY"`),
        ccolors.error("must be set"),
      ].join(" "),
      { cause: 100 },
    );
  }

  if (!git_token && !git_ssh_private_key) {
    throw new Error(
      [
        setTF_VARsLabel,
        ccolors.error("Either"),
        ccolors.key_name(`"GIT_TOKEN"`),
        ccolors.error("or"),
        ccolors.key_name(`"GIT_SSH_PRIVATE_KEY"`),
        ccolors.error("must be set"),
      ].join(" "),
      {
        cause: 101,
      },
    );
  }

  const git_repo = Deno.env.get("GIT_REPO");
  if (!git_repo) {
    throw new Error(
      [
        setTF_VARsLabel,
        ccolors.key_name(`"GIT_REPO"`),
        ccolors.error("env var is not set"),
      ].join(" "),
      {
        cause: 102,
      },
    );
  }

  if (!isClusterless) {
    const argocd_admin_password = Deno.env.get("ARGOCD_ADMIN_PASSWORD");
    if (!argocd_admin_password) {
      throw new Error(
        [
          setTF_VARsLabel,
          ccolors.key_name(`"ARGOCD_ADMIN_PASSWORD"`),
          ccolors.error("env var is not set"),
        ].join(" "),
        {
          cause: 103,
        },
      );
    }

    const sealed_secrets_private_key = Deno.env
      .get("SEALED_SECRETS_PRIVATE_KEY")
      ?.trim();

    if (!sealed_secrets_private_key) {
      throw new Error(
        [
          setTF_VARsLabel,
          ccolors.key_name(`"SEALED_SECRETS_PRIVATE_KEY"`),
          ccolors.error("env var is not set"),
        ].join(" "),
        {
          cause: 104,
        },
      );
    }

    const sealed_secrets_public_key = Deno.env
      .get("SEALED_SECRETS_PUBLIC_KEY")
      ?.trim();

    if (!sealed_secrets_public_key) {
      throw new Error(
        [
          setTF_VARsLabel,
          ccolors.key_name(`"SEALED_SECRETS_PUBLIC_KEY"`),
          ccolors.error("env var is not set"),
        ].join(" "),
        {
          cause: 105,
        },
      );
    }
    Deno.env.set("TF_VAR_argocd_admin_password", argocd_admin_password);
    Deno.env.set("TF_VAR_sealed_secrets_public_key", sealed_secrets_public_key);
    Deno.env.set(
      "TF_VAR_sealed_secrets_private_key",
      sealed_secrets_private_key,
    );
  }

  if (git_ssh_private_key) {
    Deno.env.set("TF_VAR_git_ssh_private_key", git_ssh_private_key);
  } else {
    git_username && Deno.env.set("TF_VAR_git_username", git_username);
    git_token && Deno.env.set("TF_VAR_git_token", git_token);
  }

  const ssh_public_key = Deno.env.get("SSH_PUBLIC_KEY");

  // only required for microk8s
  if (ssh_public_key) {
    Deno.env.set("TF_VAR_ssh_public_key", ssh_public_key);
  } else {
    Deno.env.set("TF_VAR_ssh_public_key", "");
  }

  Deno.env.set("TF_VAR_git_repo", git_repo);

  // aks module requires cred be set explicitly
  const azurerm_client_id = Deno.env.get("ARM_CLIENT_ID") || "";
  const azurerm_client_secret = Deno.env.get("ARM_CLIENT_SECRET") || "";
  Deno.env.set("TF_VAR_arm_client_id", azurerm_client_id);
  Deno.env.set("TF_VAR_arm_client_secret", azurerm_client_secret);
}
