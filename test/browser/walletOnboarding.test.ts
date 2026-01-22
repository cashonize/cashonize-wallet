/**
 * Browser tests for the wallet onboarding flow.
 * Tests the 3-step create and import wallet journeys.
 *
 * Uses vi.hoisted() to ensure mocks are properly initialized before module loading.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { h, nextTick } from 'vue'

// Use vi.hoisted() to create mock functions available during vi.mock() hoisting
const { mockCreateNewWallet, mockImportWallet } = vi.hoisted(() => ({
  mockCreateNewWallet: vi.fn(),
  mockImportWallet: vi.fn(),
}))

vi.mock('src/utils/walletUtils', () => ({
  createNewWallet: mockCreateNewWallet,
  importWallet: mockImportWallet,
}))

import walletOnboarding from 'src/components/walletOnboarding.vue'
import { localStorageMock } from './setup'

function mountOnboarding() {
  const pinia = createPinia()
  setActivePinia(pinia)

  return mount(walletOnboarding, {
    global: {
      plugins: [pinia],
      stubs: {
        seedPhraseInput: {
          name: 'seedPhraseInput',
          props: ['modelValue', 'isValid'],
          emits: ['update:modelValue', 'update:isValid'],
          setup(props: { modelValue?: string; isValid?: boolean }, { emit }: { emit: (event: string, value: unknown) => void }) {
            return () => h('div', { 'data-testid': 'seed-phrase-stub' }, [
              h('input', {
                'data-testid': 'seed-phrase-input',
                value: props.modelValue,
                onInput: (e: Event) => emit('update:modelValue', (e.target as HTMLInputElement).value),
              }),
              h('button', {
                'data-testid': 'set-valid',
                onClick: () => emit('update:isValid', true),
              }, 'Set Valid'),
            ])
          },
        },
        Toggle: {
          name: 'Toggle',
          props: ['modelValue'],
          emits: ['update:modelValue', 'change'],
          setup(props: { modelValue?: boolean }, { emit }: { emit: (event: string, value?: unknown) => void }) {
            return () => h('input', {
              type: 'checkbox',
              checked: props.modelValue,
              onChange: (e: Event) => {
                emit('update:modelValue', (e.target as HTMLInputElement).checked)
                emit('change')
              },
            })
          },
        },
      },
    },
  })
}

describe('Wallet Onboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.store = {}
    mockCreateNewWallet.mockReset()
    mockCreateNewWallet.mockResolvedValue({ success: false, message: 'Mock not configured', isUserError: true })
    mockImportWallet.mockReset()
    mockImportWallet.mockResolvedValue({ success: false, message: 'Mock not configured', isUserError: true })
  })

  describe('Step 1: Welcome', () => {
    it('shows welcome screen with create and import options', () => {
      const wrapper = mountOnboarding()

      expect(wrapper.find('[data-testid="step-1"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="create-wallet-cta"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="import-wallet-cta"]').exists()).toBe(true)
    })
  })

  describe('Create wallet flow', () => {
    it('clicking create shows step 2 with wallet name input', async () => {
      const wrapper = mountOnboarding()

      await wrapper.find('[data-testid="create-wallet-cta"]').trigger('click')
      await nextTick()

      expect(wrapper.find('[data-testid="step-2"]').exists()).toBe(true)
      expect(wrapper.find('#walletName').exists()).toBe(true)
      expect(wrapper.find('legend').text()).toBe('Create new wallet')
    })

    it('back button returns to step 1', async () => {
      const wrapper = mountOnboarding()

      await wrapper.find('[data-testid="create-wallet-cta"]').trigger('click')
      await nextTick()
      await wrapper.find('[data-testid="back-button"]').trigger('click')
      await nextTick()

      expect(wrapper.find('[data-testid="step-1"]').exists()).toBe(true)
    })

    it('successful creation advances to preferences (step 3)', async () => {
      mockCreateNewWallet.mockResolvedValue({ success: true, walletName: 'mywallet' })
      const wrapper = mountOnboarding()

      await wrapper.find('[data-testid="create-wallet-cta"]').trigger('click')
      await nextTick()
      await wrapper.find('[data-testid="create-wallet-submit"]').trigger('click')
      await flushPromises()

      expect(mockCreateNewWallet).toHaveBeenCalledWith('mywallet')
      expect(wrapper.find('[data-testid="step-3"]').exists()).toBe(true)
    })

    it('failed creation stays on step 2', async () => {
      mockCreateNewWallet.mockResolvedValue({
        success: false,
        message: 'Wallet already exists',
        isUserError: true,
      })
      const wrapper = mountOnboarding()

      await wrapper.find('[data-testid="create-wallet-cta"]').trigger('click')
      await nextTick()
      await wrapper.find('[data-testid="create-wallet-submit"]').trigger('click')
      await flushPromises()

      expect(wrapper.find('[data-testid="step-2"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="step-3"]').exists()).toBe(false)
    })

    it('passes custom wallet name to createNewWallet', async () => {
      mockCreateNewWallet.mockResolvedValue({ success: true, walletName: 'customwallet' })
      const wrapper = mountOnboarding()

      await wrapper.find('[data-testid="create-wallet-cta"]').trigger('click')
      await nextTick()
      await wrapper.find('#walletName').setValue('customwallet')
      await wrapper.find('[data-testid="create-wallet-submit"]').trigger('click')
      await flushPromises()

      expect(mockCreateNewWallet).toHaveBeenCalledWith('customwallet')
    })
  })

  describe('Import wallet flow', () => {
    it('clicking import shows step 2 with seed phrase input', async () => {
      const wrapper = mountOnboarding()

      await wrapper.find('[data-testid="import-wallet-cta"]').trigger('click')
      await nextTick()

      expect(wrapper.find('[data-testid="step-2"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="seed-phrase-input"]').exists()).toBe(true)
      expect(wrapper.find('legend').text()).toBe('Import existing wallet')
    })

    it('successful import advances to preferences with correct payload', async () => {
      mockImportWallet.mockResolvedValue({ success: true, walletName: 'mywallet' })
      const wrapper = mountOnboarding()

      await wrapper.find('[data-testid="import-wallet-cta"]').trigger('click')
      await nextTick()
      await wrapper.find('[data-testid="set-valid"]').trigger('click')
      await wrapper.find('[data-testid="seed-phrase-input"]').setValue('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about')
      await nextTick()
      await wrapper.find('[data-testid="import-wallet-submit"]').trigger('click')
      await flushPromises()

      expect(mockImportWallet).toHaveBeenCalledWith({
        name: 'mywallet',
        seedPhrase: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
        seedPhraseValid: true,
        derivationPath: 'standard',
      })
      expect(wrapper.find('[data-testid="step-3"]').exists()).toBe(true)
    })

    it('failed import stays on step 2', async () => {
      mockImportWallet.mockResolvedValue({
        success: false,
        message: 'Invalid seed phrase',
        isUserError: false,
      })
      const wrapper = mountOnboarding()

      await wrapper.find('[data-testid="import-wallet-cta"]').trigger('click')
      await nextTick()
      await wrapper.find('[data-testid="set-valid"]').trigger('click')
      await nextTick()
      await wrapper.find('[data-testid="import-wallet-submit"]').trigger('click')
      await flushPromises()

      expect(wrapper.find('[data-testid="step-2"]').exists()).toBe(true)
    })

    it('uses selected derivation path in payload', async () => {
      mockImportWallet.mockResolvedValue({ success: true, walletName: 'mywallet' })
      const wrapper = mountOnboarding()

      await wrapper.find('[data-testid="import-wallet-cta"]').trigger('click')
      await nextTick()
      await wrapper.find('select').setValue('bitcoindotcom')
      await wrapper.find('[data-testid="set-valid"]').trigger('click')
      await nextTick()
      await wrapper.find('[data-testid="import-wallet-submit"]').trigger('click')
      await flushPromises()

      expect(mockImportWallet).toHaveBeenCalledWith(
        expect.objectContaining({ derivationPath: 'bitcoindotcom' })
      )
    })
  })

  describe('Step 3: Preferences', () => {
    it('shows preferences form after successful wallet creation', async () => {
      mockCreateNewWallet.mockResolvedValue({ success: true, walletName: 'mywallet' })
      const wrapper = mountOnboarding()

      await wrapper.find('[data-testid="create-wallet-cta"]').trigger('click')
      await nextTick()
      await wrapper.find('[data-testid="create-wallet-submit"]').trigger('click')
      await flushPromises()

      expect(wrapper.find('[data-testid="step-3"]').exists()).toBe(true)
      expect(wrapper.find('#selectCurrency').exists()).toBe(true)
      expect(wrapper.find('input[value="Finish Setup"]').exists()).toBe(true)
    })
  })
})
