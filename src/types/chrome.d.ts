// The small slice of the Chrome extension API the BEX bridge uses. The full @types/chrome package
// is not a dependency: keeping the surface explicit also keeps the wallet from growing extension
// API access it does not need. The declaration is global, so it does not stop code shared with
// the other builds from touching `chrome`: such code checks import.meta.env.QUASAR_BEX_MODE.
declare namespace chrome {
  namespace runtime {
    interface MessageSender {
      origin?: string
      tab?: { id?: number; windowId?: number }
    }

    interface Port {
      name: string
      sender?: MessageSender
      onMessage: { addListener(listener: (message: unknown) => void): void }
      onDisconnect: { addListener(listener: () => void): void }
      postMessage(message: unknown): void
      disconnect(): void
    }

    const onConnect: { addListener(listener: (port: Port) => void): void }

    function connect(info: { name: string }): Port
    function getURL(path: string): string
  }

  namespace tabs {
    function update(tabId: number, updateProperties: { active?: boolean }): Promise<unknown>
  }

  namespace storage {
    interface StorageArea {
      get(keys?: string | string[] | null): Promise<Record<string, unknown>>
      set(items: Record<string, unknown>): Promise<void>
      remove(keys: string | string[]): Promise<void>
      setAccessLevel(options: { accessLevel: 'TRUSTED_CONTEXTS' | 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }): Promise<void>
    }

    const local: StorageArea
    const session: StorageArea
    const onChanged: {
      addListener(listener: (
        changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
        areaName: string,
      ) => void): void
    }
  }

  namespace windows {
    interface Window {
      id?: number
      left?: number
      top?: number
      width?: number
      height?: number
      type?: 'normal' | 'popup' | 'panel' | 'app' | 'devtools'
    }

    function create(createData: {
      type?: 'normal' | 'popup'
      url?: string
      width?: number
      height?: number
      left?: number
      top?: number
      focused?: boolean
    }): Promise<Window>

    function update(windowId: number, updateInfo: {
      left?: number
      top?: number
      focused?: boolean
    }): Promise<Window>

    function getLastFocused(getInfo?: { populate?: boolean }): Promise<Window>
    function getCurrent(getInfo?: { populate?: boolean }): Promise<Window>
  }
}
