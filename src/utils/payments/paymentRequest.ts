/**
 * Payment requests: building one to hand out, and reading the token parameters off one the
 * user was given. The URI itself is BIP21, parsed by bip21.ts; a request for a token adds the
 * parameters CHIP-2023-05-PayPro defines on top of it.
 * PayPro spec: https://github.com/bitjson/chip-paypro
 *
 * Only PayPro's token parameters are implemented: c for the category and f for the fungible
 * amount, with ft accepted as the alias other wallets and older requests use. Its n, s and e
 * parameters and its alphanumeric QR mode are not handled, and the amount of a plain BCH
 * request is written as BIP21's amount= rather than the CHIP's s=.
 *
 * Every mention of those parameter names lives here, so reading a request and building one
 * cannot drift apart.
 */

import { Notify } from "quasar";
import type { Bip21ParseResult } from 'src/utils/payments/bip21';
import { parseBip21Uri, isBip21Uri, getBip21ValidationError, formatSatoshisAsBch } from 'src/utils/payments/bip21';
import { i18n } from 'src/boot/i18n'
const { t } = i18n.global

export interface PayProParams {
  /** Token category being requested */
  category?: string | undefined;
  /** Fungible amount in base units, undefined when absent or not a plain integer */
  fungibleAmount?: bigint | undefined;
}

// The amount arrives in base units and is read as a bigint, token supplies go well past what
// a number holds exactly.
export function parsePayProParams(parsed: Bip21ParseResult): PayProParams {
  const fungibleAmountParam = parsed.otherParams?.f ?? parsed.otherParams?.ft;
  const hasValidAmount = fungibleAmountParam !== undefined && /^\d+$/.test(fungibleAmountParam);
  return {
    category: parsed.otherParams?.c,
    fungibleAmount: hasValidAmount ? BigInt(fungibleAmountParam) : undefined
  };
}

/** The parameters Cashonize puts in a payment request it generates */
export interface PaymentRequestParams extends PayProParams {
  /** Full cashaddress including the scheme prefix, as the wallet hands it out */
  address: string;
  /** Requested amount in satoshis, left out of the URI when zero or undefined */
  satoshis?: bigint | undefined;
  /** Note for the payer, shown by wallets that display it */
  message?: string | undefined;
}

/**
 * Build a payment request URI.
 *
 * Only emits the parameters Cashonize itself understands when paying, so a request
 * generated here can always be paid back by another Cashonize wallet.
 */
export function buildPaymentRequestUri({ address, satoshis, message, category, fungibleAmount }: PaymentRequestParams) {
  const params: string[] = [];
  if (satoshis !== undefined && satoshis > 0n) params.push(`amount=${formatSatoshisAsBch(satoshis)}`);
  if (category) {
    params.push(`c=${category}`);
    if (fungibleAmount !== undefined && fungibleAmount > 0n) params.push(`f=${fungibleAmount}`);
  }
  if (message) params.push(`message=${encodeURIComponent(message)}`);
  if (!params.length) return address;
  return `${address}?${params.join('&')}`;
}

/**
 * Read a payment request pasted into the address field of a token's send form.
 *
 * Returns undefined when the input is not a request to act on, either because it is a plain
 * address or because the request cannot be paid from this form; the reason is shown to the user
 * as a notification, since the address field has no error state of its own.
 */
export function parseTokenPaymentRequest(addressInput: string, expectedCategory: string) {
  if(!isBip21Uri(addressInput) || !addressInput.includes("?")) return;

  try {
    const parsed = parseBip21Uri(addressInput);
    const validationError = getBip21ValidationError(parsed);
    if (validationError) {
      Notify.create({ message: validationError, icon: 'warning', color: "red" });
      return;
    }

    const payProParams = parsePayProParams(parsed);
    if(payProParams.category && payProParams.category !== expectedCategory){
      Notify.create({ message: t('tokenItem.errors.differentTokenRequest'), icon: 'warning', color: "grey-7" });
      return;
    }

    return { address: parsed.address, ...payProParams };
  } catch {
    // If parsing fails, leave the input as-is.
  }
}
