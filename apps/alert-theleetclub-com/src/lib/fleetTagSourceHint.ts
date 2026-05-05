/** Maps API `vendon_tag_source` to operator-facing copy (no repo paths or internal schema names). */
export function fleetTagSourceDescription(source: string | null | undefined): string | null {
  if (!source || source === 'none') return null;
  const labels: Record<string, string> = {
    device_short_field: 'Taken from the short description on the device',
    call_in_code: 'Taken from the call-in code on the device',
    asset_field: 'Taken from an asset or unit tag field on the device',
    machine_tag_id: 'Taken from the machine tag identifier on the device',
    top_level_tag: 'Taken from the tag field on the device',
    display_tag: 'Taken from a display tag field on the device',
    structured_tags: 'Taken from tag rows on the device (machine / fleet oriented)',
    nested_field: 'Taken from an extra field on the device record',
    fleet_group: 'Taken from the fleet or operator group',
    platform_tags: 'Taken from tag rows on the device',
    machine_name: 'Parsed from the vending machine name',
    machine_name_prefix: 'Taken from a short code at the start of the machine name',
  };
  return labels[source] ?? 'Taken from your vending platform data';
}
