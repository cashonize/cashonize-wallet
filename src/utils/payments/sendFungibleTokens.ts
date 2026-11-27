// One send of a fungible token, from the amount and address as typed to the broadcast: shared by
// the token's row on the Tokens tab and the send page.

import { TokenSendRequest } from '@cashonize/bch-wallet-lib'
import { useStore } from 'src/stores/store'
import { useSettingsStore } from 'src/stores/settingsStore'
import type { TokenDataFT } from 'src/interfaces/interfaces'
import { parseTokenAmountToBigInt, formatTokenAmount, formatFiatAmount } from 'src/utils/utils'
import { shownTokenFiatValue } from 'src/utils/defi/tokenFiatValue'
import { validateTokenRecipientAddress } from 'src/utils/payments/recipientAddress'
import { confirmSend, notifySending, handleTransactionBroadcastSuccess } from 'src/utils/txHelpers'
import { i18n } from 'src/boot/i18n'
const { t } = i18n.global

/** The fungible tokens the wallet can send: what it holds of them, minus what is held back */
export function sendableFungibleTokens(): TokenDataFT[] {
  const tokenList = useStore().tokenList ?? [];
  return tokenList.filter((tokenData): tokenData is TokenDataFT => 'amount' in tokenData && tokenData.amount > 0n);
}

/**
 * Throws with the reason when the address or amount cannot be sent. `onBroadcast` runs as soon as
 * the transaction is out, before anything that can still fail: the place to empty a form, so a
 * late error does not leave a sent payment looking unsent.
 */
export async function sendFungibleTokens(category: string, destination: string, typedAmount: string, onBroadcast: () => void) {
  const store = useStore()
  const settingsStore = useSettingsStore()
  if((store.spendableBalance ?? 0n) < 550n) throw new Error(t('tokenItem.errors.needBchForFee'));
  const recipient = validateTokenRecipientAddress(destination, store.wallet.networkPrefix);
  if(!typedAmount) throw new Error(t('tokenItem.errors.noValidAmount'));
  const tokenMetaData = store.bcmrRegistries?.[category];
  const decimals = tokenMetaData?.token?.decimals ?? 0;
  const amountTokensInt = parseTokenAmountToBigInt(typedAmount, decimals);
  if(amountTokensInt <= 0n) throw new Error(t('tokenItem.errors.noValidAmount'));
  const amountSentFormatted = formatTokenAmount(amountTokensInt, decimals)
  const spendableAmount = sendableFungibleTokens().find(tokenData => tokenData.category === category)?.amount ?? 0n;
  if(amountTokensInt > spendableAmount) throw new Error(t('tokenItem.errors.insufficientBalance'));

  const fiatValue = shownTokenFiatValue(category, amountTokensInt);
  const sendInfo = {
    recipient,
    amount: amountSentFormatted,
    unit: tokenMetaData?.token?.symbol ?? category.slice(0, 8),
    fiat: fiatValue === null ? undefined : formatFiatAmount(fiatValue, settingsStore.currency),
    token: { category, iconUrl: store.tokenIconUrl(category) },
  }
  // confirm payment if setting is enabled
  if (settingsStore.confirmBeforeSending && !await confirmSend(sendInfo)) return

  notifySending();
  const { txId } = await store.spend.send([
    new TokenSendRequest({ cashaddr: recipient, amount: amountTokensInt, category }),
  ]);
  onBroadcast();
  const displayId = `${category.slice(0, 20)}...${category.slice(-8)}`;
  let alertMessage = t('tokenItem.alerts.sentTokensNoSymbol', { amount: amountSentFormatted, tokenId: displayId, address: recipient });
  if (tokenMetaData?.token?.symbol) {
    alertMessage = t('tokenItem.alerts.sentTokens', { amount: amountSentFormatted, symbol: tokenMetaData.token.symbol, address: recipient });
  }
  await handleTransactionBroadcastSuccess(alertMessage, txId, t('tokenItem.success.transactionSent'), sendInfo);
}
