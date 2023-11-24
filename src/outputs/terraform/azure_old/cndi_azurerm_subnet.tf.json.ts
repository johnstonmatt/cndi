import { getPrettyJSONString, getTFResource } from "src/utils.ts";

export default function getAzureSubnetTFJSON(): string {
  const resource = getTFResource("azurerm_subnet", {
    address_prefixes: ["10.0.0.0/24"],
    name: "cndi_subnet",
    resource_group_name:
      "${azurerm_resource_group.cndi_azurerm_resource_group.name}",
    virtual_network_name:
      "${azurerm_virtual_network.cndi_azurerm_virtual_network.name}",
  });
  return getPrettyJSONString(resource);
}
