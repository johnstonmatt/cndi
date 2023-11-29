import { getPrettyJSONString, getTFResource } from "src/utils.ts";

export default function getGCPComputeRouterNatTFJSON(): string {
  const resource = getTFResource("google_compute_router_nat", {
    name: "cndi-router-nat",
    nat_ip_allocate_option: "AUTO_ONLY",
    router: "${google_compute_router.cndi_google_compute_router.name}",
    source_subnetwork_ip_ranges_to_nat: "ALL_SUBNETWORKS_ALL_IP_RANGES",
  });
  return getPrettyJSONString(resource);
}
