// The metadata a dApp shows in the wallet. WalletConnect and WizardConnect dApps declare it;
// an injected EVM dApp declares none, so the wallet presents the page it runs on. A dApp that
// declares part of it gets its own fields rendered and the page's values for the rest.

export interface DappPageMetadata {
  name: string
  description?: string | undefined
  icons?: string[] | undefined
}

const LOCAL_HTTP_ICON = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\//

// What an extension page may load as an icon: https, a data:image URI, or local development's
// http. Other schemes are dropped like any other unusable field.
export function isUsableIcon(value: string): boolean {
  return value.startsWith('https://')
    || value.startsWith('data:image/')
    || LOCAL_HTTP_ICON.test(value)
}

function usableText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

// The dApp's declared metadata wins field by field; every field it leaves out (or fills with
// something the wallet cannot render) comes from the page it runs on. Other fields are dropped:
// the wallet shows the attested origin, never a declared url.
export function mergeDappMetadata(supplied: unknown, page: DappPageMetadata): DappPageMetadata {
  const record = supplied && typeof supplied === 'object' && !Array.isArray(supplied)
    ? supplied as Record<string, unknown>
    : {}
  const { icon, icons } = record
  const declaredIcons = [
    ...(Array.isArray(icons) ? icons : []),
    ...(icon !== undefined ? [icon] : []),
  ].filter((value): value is string => typeof value === 'string' && isUsableIcon(value))

  const name = usableText(record.name)?.slice(0, 64) ?? page.name
  const description = usableText(record.description)?.slice(0, 256) ?? page.description
  const pageIcons = (page.icons ?? []).filter(isUsableIcon)
  const chosenIcons = (declaredIcons.length ? declaredIcons : pageIcons).slice(0, 1)

  return {
    name,
    ...(description ? { description } : {}),
    ...(chosenIcons.length ? { icons: chosenIcons } : {}),
  }
}
