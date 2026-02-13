<script setup lang="ts">
  import { ref, onMounted, toRefs, computed, watch, nextTick } from 'vue';
  import dialogNftIcon from './dialogNftIcon.vue'
  import nftChild from './nftChild.vue'
  import { TokenSendRequest, TokenMintRequest, type SendRequest, type TokenI } from "mainnet-js"
  import { bigIntToVmNumber, binToHex, decodeCashAddress } from "@bitauth/libauth"
  import alertDialog from 'src/components/general/alertDialog.vue'
  import QrCodeDialog from '../qr/qrCodeScanDialog.vue';
  import type { TokenDataNFT, BcmrTokenMetadata } from "src/interfaces/interfaces"
  import { querySupplyNFTs, queryActiveMinting } from "src/queryChainGraph"
  import { copyToClipboard } from 'src/utils/utils';
  import { parseBip21Uri, isBip21Uri, getBip21ValidationError } from 'src/utils/bip21';
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import type { ParseResult } from 'src/parsing/nftParsing'
  import { caughtErrorToString } from 'src/utils/errorHandling'
  import { appendBlockieIcon } from 'src/utils/blockieIcon'
  import { useQuasar } from 'quasar'
  import { useI18n } from 'vue-i18n'
  const $q = useQuasar()
  const store = useStore()
  const settingsStore = useSettingsStore()
  const { t } = useI18n()
  import { useWindowSize } from '@vueuse/core'
  const { width } = useWindowSize();
  const isMobile = computed(() => width.value < 480)

  const props = defineProps<{
    tokenData: TokenDataNFT,
  }>()
  const { tokenData } = toRefs(props);

  const showNftImage = ref(false);
  const displaySendNft = ref(false);
  const displayBatchTransfer = ref(false);
  const displayMintNfts = ref(false);
  const displayBurnNft = ref(false);
  const displayAuthTransfer = ref(false);
  const displayTokenInfo = ref(false);
  const displayChildNfts = ref(false);
  const loadingChildNftMetadata = ref(false);
  const destinationAddr = ref("");
  const tokenMetaData = ref(undefined as (BcmrTokenMetadata | undefined));
  const mintUniqueNfts = ref(true);
  const numberingUniqueNfts = ref("vm-numbers" as "vm-numbers" | "hex-numbers");
  const mintCommitment = ref("");
  const mintAmountNfts = ref(undefined as string | undefined);
  const startingNumberNFTs = ref(undefined as string | undefined);
  const totalNumberNFTs = ref(undefined as number | undefined);
  const hasMintingNFT = ref(undefined as boolean | undefined);
  const showQrCodeDialog = ref(false);
  // Local state for batch NFT selection - keyed by "txid:vout"
  const selectedNfts = ref(new Set<string>());
  const activeAction = ref<'sending' | 'minting' | 'burning' | 'transferAuth' | null>(null);
  const imageLoadFailed = ref(false);
  const parseResult = ref(undefined as ParseResult | undefined);

  const isParsable = computed(() =>
    store.bcmrRegistries?.[tokenData.value.category]?.nft_type === 'parsable'
  );

  let fetchedMetadataChildren = false

  tokenMetaData.value = store.bcmrRegistries?.[tokenData.value.category] ?? undefined;

  const isSingleNft = computed(() => tokenData.value.nfts?.length == 1);
  const isSingleMintingNft = computed(() => isSingleNft.value && tokenData.value.nfts?.[0]?.token?.nft?.capability == 'minting');
  const nftMetadata = computed(() => {
    if(!isSingleNft.value) return
    const nftData = tokenData.value.nfts?.[0];
    const commitment = nftData?.token?.nft?.commitment;
    const matchedNftMetadata = tokenMetaData?.value?.nfts?.[commitment ?? ""]
    return matchedNftMetadata ? matchedNftMetadata : tokenMetaData?.value
  })
  const httpsUrlTokenIcon = computed(() => {
    let tokenIconUri = tokenMetaData.value?.uris?.icon;
    if(isSingleNft.value){
      const nftIconUri = nftMetadata.value?.uris?.icon;
      if(nftIconUri) tokenIconUri = nftIconUri;
    }
    if(tokenIconUri?.startsWith('ipfs://')){
      return settingsStore.ipfsGateway + tokenIconUri.slice(7);
    }
    return tokenIconUri;
  })
  const tokenName = computed(() => {
    // Prefer parsed type name when available (e.g. extension-resolved loan keys)
    if(parseResult.value?.success && parseResult.value.nftTypeName) return parseResult.value.nftTypeName;
    let tokenName = tokenMetaData.value?.name;
    if(isSingleNft.value) tokenName = nftMetadata.value?.name;
    return tokenName;
  })
  const tokenDescription = computed(() => {
    if(parseResult.value?.success && parseResult.value.nftTypeDescription) return parseResult.value.nftTypeDescription;
    return tokenMetaData.value?.description;
  })
  const commitmentDisplay = computed(() => {
    const commitment = tokenData.value.nfts?.[0]?.token?.nft?.commitment;
    if (!commitment) return t('tokenItem.empty');
    if (commitment.length > 40) return commitment.slice(0, 20) + '...' + commitment.slice(-20);
    return commitment;
  })
  const selectedNftCount = computed(() => selectedNfts.value.size);

  function getNftKey(txid: string, vout: number) {
    return `${txid}:${vout}`;
  }

  function isNftSelected(txid: string, vout: number) {
    return selectedNfts.value.has(getNftKey(txid, vout));
  }

  function toggleNftSelection(txid: string, vout: number) {
    const key = getNftKey(txid, vout);
    if (selectedNfts.value.has(key)) {
      selectedNfts.value.delete(key);
    } else {
      selectedNfts.value.add(key);
    }
    // Trigger reactivity
    selectedNfts.value = new Set(selectedNfts.value);
  }

  function clearSelection() {
    selectedNfts.value = new Set();
  }

  function selectAllNfts() {
    const allKeys = tokenData.value.nfts?.map(nft => getNftKey(nft.txid, nft.vout)) ?? [];
    selectedNfts.value = new Set(allKeys);
  }

  onMounted(() => {
    appendBlockieIcon(tokenData.value.category, `#id${tokenData.value.category.slice(0, 10)}nft`);
    // Parse NFT commitment if this is a parsable single NFT
    if (isSingleNft.value && isParsable.value) {
      const nftUtxo = tokenData.value.nfts?.[0];
      if (nftUtxo) {
        parseResult.value = store.parseNftCommitment(tokenData.value.category, nftUtxo);
      }
    }
  })

  // Watch for isParsable becoming true after mount (e.g. bcmrRegistries loads async)
  watch(isParsable, (nowParsable) => {
    if (nowParsable && isSingleNft.value && !parseResult.value) {
      const nftUtxo = tokenData.value.nfts?.[0];
      if (nftUtxo) {
        parseResult.value = store.parseNftCommitment(tokenData.value.category, nftUtxo);
      }
    }
  })

  watch(imageLoadFailed, async (failedToLoad) => {
    if(failedToLoad) {
      await nextTick();
      appendBlockieIcon(tokenData.value.category, `#id${tokenData.value.category.slice(0, 10)}nft`);
    }
  })

  // check if need to fetch onchain stats on displayTokenInfo
  watch(displayTokenInfo, async() => {
    if(!totalNumberNFTs.value && tokenData.value?.nfts && hasMintingNFT.value == undefined){
      try {
        const [supplyNFTs, activeMintingCount] = await Promise.all([
          querySupplyNFTs(tokenData.value.category, settingsStore.chaingraph),
          queryActiveMinting(tokenData.value.category, settingsStore.chaingraph)
        ]);
        totalNumberNFTs.value = supplyNFTs;
        hasMintingNFT.value = activeMintingCount > 0;
      } catch (error) {
        console.error("Failed to fetch NFT stats:", error);
      }
    }
  })

  async function showChildNfts() {
    if(!fetchedMetadataChildren && tokenMetaData.value){
      loadingChildNftMetadata.value = true;
      console.time('fetch NFT info');
      await store.fetchTokenMetadata([tokenData.value], true)
      fetchedMetadataChildren = true
      console.timeEnd('fetch NFT info');
      loadingChildNftMetadata.value = false;
    }
    displayChildNfts.value = !displayChildNfts.value;
  }
  
  const qrDecode = (content: string) => {
    destinationAddr.value = content;
    parseAddrParams();
  }
  
  function parseAddrParams(){
    if(!isBip21Uri(destinationAddr.value) || !destinationAddr.value.includes("?")) return;

    // Parse BIP21 URIs with query params
    try {
      const parsed = parseBip21Uri(destinationAddr.value);

      const validationError = getBip21ValidationError(parsed);
      if (validationError) {
        $q.notify({ message: validationError, icon: 'warning', color: "red" });
        return;
      }

      // Check if c= is for a different token
      if(parsed.otherParams?.c && parsed.otherParams.c !== tokenData.value.category){
        $q.notify({ message: t('tokenItem.errors.differentTokenRequest'), icon: 'warning', color: "grey-7" });
        return;
      }

      // Set the address (without query params)
      destinationAddr.value = parsed.address;
    } catch {
      // If parsing fails, leave the input as-is
    }
  }
  const qrFilter = (content: string) => {
    // Extract address from BIP21 URI if needed
    let addressToCheck = content;
    if(isBip21Uri(content) && content.includes("?")){
      try {
        const parsed = parseBip21Uri(content);
        addressToCheck = parsed.address;
      } catch {
        // If parsing fails, try with original content
      }
    }
    const decoded = decodeCashAddress(addressToCheck);
    if (typeof decoded === "string" || decoded.prefix !== store.wallet.networkPrefix) {
      return t('tokenItem.errors.notCashaddress');
    }
    return true;
  }
  // NFT Group specific functionality
  async function sendBatchNfts(){
    if (activeAction.value) return;
    activeAction.value = 'sending';
    try{
      if(selectedNftCount.value === 0) throw(t('tokenItem.errors.noNftsSelected'))
      if(!destinationAddr.value) throw(t('tokenItem.errors.noDestination'))
      if(!destinationAddr.value.startsWith("bitcoincash:") && !destinationAddr.value.startsWith("bchtest:")){
        const networkPrefix = store.network == 'mainnet' ? "bitcoincash:" : "bchtest:"
        destinationAddr.value = networkPrefix + destinationAddr.value
      }
      const decodedAddress = decodeCashAddress(destinationAddr.value)
      if(typeof decodedAddress == 'string') throw(t('tokenItem.errors.invalidAddress'))
      const supportsTokens = (decodedAddress.type === 'p2pkhWithTokens' || decodedAddress.type === 'p2shWithTokens');
      if(!supportsTokens ) throw(t('tokenItem.errors.notTokenAddress'));
      if((store.balance ?? 0n) < 550n) throw(t('tokenItem.errors.needBchForFee'));

      const category = tokenData.value.category;
      const isAllSelected = selectedNftCount.value === tokenData.value.nfts?.length;
      const nftCount = selectedNftCount.value;

      // confirm payment if setting is enabled
      if (settingsStore.confirmBeforeSending) {
        const tokenSymbol = tokenMetaData.value?.token?.symbol ?? category.slice(0, 8)
        const truncatedAddr = `${destinationAddr.value.slice(0, 24)}...${destinationAddr.value.slice(-8)}`
        const confirmed = await new Promise<boolean>((resolve) => {
          $q.dialog({
            title: t('tokenItem.dialogs.confirmNftTransfer.title'),
            message: t('tokenItem.dialogs.confirmNftTransfer.message', { prefix: isAllSelected ? 'all ' : '', count: nftCount, symbol: tokenSymbol, address: truncatedAddr }),
            html: true,
            cancel: { flat: true, color: 'dark' },
            ok: { label: t('tokenItem.dialogs.confirmButton'), color: 'primary', textColor: 'white' },
            persistent: true
          }).onOk(() => resolve(true))
            .onCancel(() => resolve(false))
        })
        if (!confirmed) return
      }

      // Get selected NFTs from the full list
      const selectedNftsList = tokenData.value.nfts?.filter(nft =>
        selectedNfts.value.has(getNftKey(nft.txid, nft.vout))
      ) ?? [];

      const outputArray:TokenSendRequest[] = [];
      selectedNftsList.forEach(nftItem => {
        outputArray.push(
          new TokenSendRequest({
          cashaddr: destinationAddr.value,
          category: category,
          nft: {
            commitment: nftItem.token!.nft!.commitment,
            capability: nftItem.token!.nft!.capability,
          },
        }))
      })
      $q.notify({
        spinner: true,
        message: t('common.status.sending'),
        color: 'grey-5',
        timeout: 1000
      })
      const { txId } = await store.wallet.send(outputArray);
      const displayId = `${category.slice(0, 20)}...${category.slice(-8)}`;
      let alertMessage = t('tokenItem.alerts.sentNfts', { count: nftCount, category: displayId, address: destinationAddr.value });
      if (isAllSelected) {
        alertMessage = t('tokenItem.alerts.sentAllNfts', { category: displayId, address: destinationAddr.value });
      }
      $q.dialog({
        component: alertDialog,
        componentProps: {
          alertInfo: { message: alertMessage, txid: txId }
        }
      })
      $q.notify({
        type: 'positive',
        message: t('tokenItem.success.transactionSent')
      })
      console.log(alertMessage);
      console.log(`${store.explorerUrl}/${txId}`);
      destinationAddr.value = "";
      displayBatchTransfer.value = false;
      clearSelection();
      // update utxo list
      await store.updateWalletUtxos();
      // update wallet history as fire-and-forget promise
      void store.updateWalletHistory();
    }catch(error){
      handleTransactionError(error)
    } finally {
      activeAction.value = null;
    }
  }
  // single NFT specific functionality
  async function sendNft(){
    if (activeAction.value) return;
    activeAction.value = 'sending';
    try{
      if(!destinationAddr.value) throw(t('tokenItem.errors.noDestination'))
      if(!destinationAddr.value.startsWith("bitcoincash:") && !destinationAddr.value.startsWith("bchtest:")){
        const networkPrefix = store.network == 'mainnet' ? "bitcoincash:" : "bchtest:"
        destinationAddr.value = networkPrefix + destinationAddr.value
      }
      const decodedAddress = decodeCashAddress(destinationAddr.value)
      if(typeof decodedAddress == 'string') throw(t('tokenItem.errors.invalidAddress'))
      const supportsTokens = (decodedAddress.type === 'p2pkhWithTokens' || decodedAddress.type === 'p2shWithTokens');
      if(!supportsTokens) throw(t('tokenItem.errors.notTokenAddress'));
      if((store.balance ?? 0n) < 550n) throw(t('tokenItem.errors.needBchForFee'));

      // confirm payment if setting is enabled
      if (settingsStore.confirmBeforeSending) {
        const tokenSymbol = tokenMetaData.value?.token?.symbol ?? tokenData.value.category.slice(0, 8)
        const truncatedAddr = `${destinationAddr.value.slice(0, 24)}...${destinationAddr.value.slice(-8)}`
        const confirmed = await new Promise<boolean>((resolve) => {
          $q.dialog({
            title: t('tokenItem.dialogs.confirmNftSend.title'),
            message: t('tokenItem.dialogs.confirmNftSend.message', { symbol: tokenSymbol, address: truncatedAddr }),
            html: true,
            cancel: { flat: true, color: 'dark' },
            ok: { label: t('tokenItem.dialogs.confirmButton'), color: 'primary', textColor: 'white' },
            persistent: true
          }).onOk(() => resolve(true))
            .onCancel(() => resolve(false))
        })
        if (!confirmed) return
      }

      const category = tokenData.value.category;
      const nftInfo = tokenData.value.nfts?.[0]?.token as TokenI;
      $q.notify({
        spinner: true,
        message: t('common.status.sending'),
        color: 'grey-5',
        timeout: 1000
      })
      const { txId } = await store.wallet.send([
        new TokenSendRequest({
          cashaddr: destinationAddr.value,
          category: category,
          nft: {
            commitment: nftInfo.nft!.commitment,
            capability: nftInfo.nft!.capability,
          },
        }),
      ]);
      const displayId = `${category.slice(0, 20)}...${category.slice(-8)}`;
      const alertMessage = t('tokenItem.alerts.sentNft', { category: displayId, address: destinationAddr.value });
      $q.dialog({
        component: alertDialog,
        componentProps: {
          alertInfo: { message: alertMessage, txid: txId }
        }
      })
      $q.notify({
        type: 'positive',
        message: t('tokenItem.success.transactionSent')
      })
      console.log(alertMessage)
      console.log(`${store.explorerUrl}/${txId}`);
      destinationAddr.value = "";
      displaySendNft.value = false;
      // update utxo list
      await store.updateWalletUtxos();
      // update wallet history as fire-and-forget promise
      void store.updateWalletHistory();
    }catch(error){
      handleTransactionError(error)
    } finally {
      activeAction.value = null;
    }
  }
  const isHex = (str:string) => /^[A-F0-9]+$/i.test(str);

  async function mintNfts() {
    if (activeAction.value) return;
    const category = tokenData.value.category;
    const nftInfo = tokenData.value.nfts?.[0]?.token as TokenI;
    const tokenAddr = store.wallet.getTokenDepositAddress();
    const recipientAddr = destinationAddr.value? destinationAddr.value : tokenAddr;

    activeAction.value = 'minting';
    try {
      if(!nftInfo) return;
      // mint amount should always be provided
      if(mintAmountNfts.value == undefined) throw(t('tokenItem.errors.invalidAmountNfts'));
      const mintAmount = parseInt(mintAmountNfts.value);

      // startingNumberNFTs should be provided if mintUniqueNfts is checked
      if(mintUniqueNfts.value && startingNumberNFTs.value == undefined) throw(t('tokenItem.errors.invalidStartingNumber'));
      // initialize commitment with mintCommitment or empty string
      let nftCommitment = mintUniqueNfts.value? "" : mintCommitment.value;
      const validCommitment = (isHex(nftCommitment) || nftCommitment == "")
      if(!validCommitment) throw(t('tokenItem.errors.commitmentMustBeHex', { commitment: nftCommitment }));

      if((store.balance ?? 0n) < 550n) throw(t('tokenItem.errors.needBchForFee')); 
      // construct array of TokenMintRequest
      const arraySendrequests = [];
      for (let i = 0; i < mintAmount; i++){
        if(mintUniqueNfts.value && startingNumberNFTs.value){
          const startingNumber = parseInt(startingNumberNFTs.value);
          const nftNumber = startingNumber + i;
          // handle both vm-numering and hex numbering
          if(numberingUniqueNfts.value == "vm-numbers"){
            const vmNumber = bigIntToVmNumber(BigInt(nftNumber));
            nftCommitment = binToHex(vmNumber)
          } else if(numberingUniqueNfts.value == "hex-numbers"){
            nftCommitment = nftNumber.toString(16);
            if(nftCommitment.length % 2 != 0) nftCommitment = `0${nftCommitment}`;
          }
        }
        const mintRequest = new TokenMintRequest({
          cashaddr: recipientAddr,
          nft: {
            commitment: nftCommitment,
            capability: "none",
          },
          value: 1000n,
        })
        arraySendrequests.push(mintRequest);
      }
      $q.notify({
        spinner: true,
        message: t('common.status.sending'),
        color: 'grey-5',
        timeout: 1000
      })
      const { txId } = await store.wallet.tokenMint(category, arraySendrequests);
      const displayId = `${category.slice(0, 20)}...${category.slice(-8)}`;
      const commitmentText = nftCommitment? `with commitment ${nftCommitment}`: "";
      let alertMessage = t('tokenItem.alerts.mintedNfts', { amount: mintAmount, category: displayId });
      if (mintAmount == 1) {
        alertMessage = t('tokenItem.alerts.mintedNft', { category: displayId, commitmentText });
      }
      $q.dialog({
        component: alertDialog,
        componentProps: {
          alertInfo: { message: alertMessage, txid: txId }
        }
      })
       $q.notify({
        type: 'positive',
        message: t('tokenItem.success.mintSuccessful')
      })
      console.log(alertMessage);
      console.log(`${store.explorerUrl}/${txId}`);
      // reset input fields
      displayMintNfts.value = false;
      mintCommitment.value = "";
      mintAmountNfts.value = undefined;
      startingNumberNFTs.value = undefined;
      // update utxo list
      await store.updateWalletUtxos();
      // update wallet history as fire-and-forget promise
      void store.updateWalletHistory();
    } catch (error) {
      handleTransactionError(error)
    } finally {
      activeAction.value = null;
    }
  }
  async function burnNft() {
    if (activeAction.value) return;
    activeAction.value = 'burning';
    try {
      if((store.balance ?? 0n) < 550n) throw(t('tokenItem.errors.needBchForFee'));

      const category = tokenData.value.category;
      const nftInfo = tokenData.value.nfts[0]?.token as TokenI;
      const nftTypeString = nftInfo?.nft?.capability == 'minting' ? t('tokenItem.dialogs.burnNft.nftTypeMinting') : t('tokenItem.dialogs.burnNft.nftTypeRegular')
      const confirmed = await new Promise<boolean>((resolve) => {
        $q.dialog({
          title: t('tokenItem.dialogs.burnNft.title'),
          message: t('tokenItem.dialogs.burnNft.message', { nftType: nftTypeString }),
          html: true,
          cancel: { flat: true, color: 'dark' },
          ok: { label: t('tokenItem.dialogs.burnNft.burnButton'), color: 'red', textColor: 'white' },
          persistent: true
        }).onOk(() => resolve(true))
          .onCancel(() => resolve(false))
      })
      if (!confirmed) return

      $q.notify({
        spinner: true,
        message: t('common.status.sending'),
        color: 'grey-5',
        timeout: 1000
      })
      const { txId } = await store.wallet.tokenBurn(
        {
          category: category,
          nft: {
            capability: nftInfo.nft!.capability,
            commitment: nftInfo.nft!.commitment,
          }
        },
        "burn", // optional OP_RETURN message
      );
      const displayId = `${category.slice(0, 20)}...${category.slice(-8)}`;
      const alertMessage = t('tokenItem.alerts.burnedNft', { nftType: nftTypeString, category: displayId });
      $q.dialog({
        component: alertDialog,
        componentProps: {
          alertInfo: { message: alertMessage, txid: txId }
        }
      })
       $q.notify({
        type: 'positive',
        message: t('tokenItem.success.burnSuccessful')
      })
      console.log(alertMessage);
      console.log(`${store.explorerUrl}/${txId}`);
      // update utxo list
      await store.updateWalletUtxos();
      // update wallet history as fire-and-forget promise
      void store.updateWalletHistory();
    } catch (error) {
      handleTransactionError(error)
    } finally {
      activeAction.value = null;
    }
  }
  async function transferAuth() {
    if (activeAction.value) return;
    if(!tokenData.value?.authUtxo) return;
    const category = tokenData.value.category;
    const authNft = tokenData.value.authUtxo?.token;
    activeAction.value = 'transferAuth';
    try {
      const authTransfer: SendRequest = {
        cashaddr: destinationAddr.value,
        value: 1000n,
      };
      const changeOutputNft = new TokenSendRequest({
        cashaddr: store.wallet.getTokenDepositAddress(),
        category: tokenData.value.category,
        nft: {
          commitment: authNft!.nft!.commitment,
          capability: authNft!.nft!.capability
        },
      });
      $q.notify({
        spinner: true,
        message: t('common.status.sending'),
        color: 'grey-5',
        timeout: 1000
      })
      const { txId } = await store.wallet.send([authTransfer,changeOutputNft], { ensureUtxos: [tokenData.value.authUtxo] });
      const displayId = `${category.slice(0, 20)}...${category.slice(-8)}`;
      const alertMessage = t('tokenItem.alerts.transferredAuth', { category: displayId, address: destinationAddr.value });
      $q.dialog({
        component: alertDialog,
        componentProps: {
          alertInfo: { message: alertMessage, txid: txId }
        }
      })
       $q.notify({
        type: 'positive',
        message: t('tokenItem.success.authTransferSuccessful')
      })
      displayAuthTransfer.value = false;
      destinationAddr.value = "";
      console.log(alertMessage);
      console.log(`${store.explorerUrl}/${txId}`);
      // update utxo list
      await store.updateWalletUtxos();
      // update wallet history as fire-and-forget promise
      void store.updateWalletHistory();
    } catch (error) {
      handleTransactionError(error)
    } finally {
      activeAction.value = null;
    }
  }

  function handleTransactionError(error: unknown){
    const errorMessage = caughtErrorToString(error)
    console.error(errorMessage)
    $q.notify({
      message: errorMessage,
      icon: 'warning',
      color: "red"
    }) 
  }
</script>

<template>
  <div :id="`id${tokenData.category.slice(0, 10)}nft`" class="item">
    <fieldset style="position: relative;">
      <div class="tokenInfo">
        <video
          v-if="!settingsStore.disableTokenIcons && httpsUrlTokenIcon?.endsWith('.mp4')"
          class="tokenIcon" width="48" height="48" loading="lazy"
          style="cursor: pointer;"
          @click="() => showNftImage = true"
        >
          <source :src="httpsUrlTokenIcon" type="video/mp4" />
        </video>
        <img
          v-else-if="!settingsStore.disableTokenIcons && httpsUrlTokenIcon && isSingleNft && !imageLoadFailed"
          class="tokenIcon" width="48" height="48" loading="lazy"
          style="cursor: pointer;"
          :src="httpsUrlTokenIcon"
          @click="() => showNftImage = true"
          @error="() => imageLoadFailed = true"
        >
        <img
          v-else-if="!settingsStore.disableTokenIcons && httpsUrlTokenIcon && !isSingleNft && !imageLoadFailed"
          class="tokenIcon" width="48" height="48" loading="lazy"
          :src="httpsUrlTokenIcon"
          @error="() => imageLoadFailed = true"
        >
        <div v-else id="genericTokenIcon" loading="lazy" class="tokenIcon"></div>

        <div class="tokenBaseInfo">
          <div class="tokenBaseInfo1">
            <div v-if="tokenName">{{ t('tokenItem.name') }} {{ tokenName }}</div>
            <div style="word-break: break-all;">
              {{ t('tokenItem.tokenId') }}
              <span @click="copyToClipboard(tokenData.category)" style="cursor: pointer;">
                <span class="category">
                  {{ !isMobile ? `${tokenData.category.slice(0, 20)}...${tokenData.category.slice(-8)}` :  `${tokenData.category.slice(0, 10)}...${tokenData.category.slice(-8)}`}}
                </span>
                <img class="copyIcon" src="images/copyGrey.svg">
              </span>
            </div>
            <div v-if="isSingleNft && parseResult?.success && parseResult.namedFields?.length && parseResult.namedFields.length <= 2">
              <div v-for="(field, index) in parseResult.namedFields" :key="'main-field-' + index">
                {{ field.name ?? field.fieldId ?? `Field ${index}` }}: {{ field.parsedValue?.formatted ?? field.value }}
              </div>
            </div>
            <div v-else-if="isSingleNft && parseResult?.success && parseResult.namedFields?.length" style="word-break: break-all;">
              {{ t('tokenItem.seeParsedData') }}
            </div>
            <div v-else style="word-break: break-all;" class="hide"></div>
          </div>
          <div v-if="(tokenData.nfts?.length ?? 0) > 1" class="showChildNfts">
            <div @click="showChildNfts()" class="showChildNftsToggle">
              <span class="nrChildNfts">{{ t('tokenItem.info.numberNfts') }} {{ tokenData.nfts?.length }}</span>
              <span class="hide" style="margin-left: 10px;">
                <img class="icon" :src="settingsStore.darkMode? (displayChildNfts? 'images/chevron-square-up-lightGrey.svg':'images/chevron-square-down-lightGrey.svg') :
                  (displayChildNfts? 'images/chevron-square-up.svg':'images/chevron-square-down.svg')">
              </span>
            </div>
            <div v-if="loadingChildNftMetadata" class="loadingChildNftMetadata">
              <span class="hide-mobile">{{ t('tokenItem.loading.nftMetadata') }}</span>
              <span class="show-mobile">{{ t('tokenItem.loading.nftMetadataShort') }}</span>
            </div>
          </div>
        </div>
        <span v-if="settingsStore.showTokenVisibilityToggle" @click="store.toggleHidden(tokenData.category)" class="boxStarIcon" :title="settingsStore.hiddenTokens.includes(tokenData.category) ? t('tokenItem.visibility.unhideToken') : t('tokenItem.visibility.hideToken')">
          <img :src="settingsStore.hiddenTokens.includes(tokenData.category)
            ? (settingsStore.darkMode ? 'images/eye-off-outline-lightGrey.svg' : 'images/eye-off-outline.svg')
            : (settingsStore.darkMode ? 'images/eye-outline-lightGrey.svg' : 'images/eye-outline.svg')">
        </span>
        <span @click="store.toggleFavorite(tokenData.category)" class="boxStarIcon" :title="settingsStore.featuredTokens.includes(tokenData.category) ? t('tokenItem.visibility.unfavoriteToken') : t('tokenItem.visibility.favoriteToken')">
          <img :src="settingsStore.featuredTokens.includes(tokenData.category) ? 'images/star-full.svg' :
            settingsStore.darkMode? 'images/star-empty-grey.svg' : 'images/star-empty.svg'">
        </span>
      </div>

      <div class="tokenActions">
        <div class="actionBar">
          <span v-if="tokenData?.nfts?.length == 1" @click="displaySendNft = !displaySendNft" style="margin-left: 10px;">
            <img class="icon" :src="settingsStore.darkMode? 'images/sendLightGrey.svg' : 'images/send.svg'"> {{ t('tokenItem.actions.send') }} </span>
          <span @click="displayTokenInfo = !displayTokenInfo">
            <img class="icon" :src="settingsStore.darkMode? 'images/infoLightGrey.svg' : 'images/info.svg'"> {{ t('tokenItem.actions.info') }}
          </span>
          <span v-if="(tokenData.nfts?.length ?? 0) > 1" @click="displayBatchTransfer = !displayBatchTransfer" style="margin-left: 10px;">
            <img class="icon" :src="settingsStore.darkMode? 'images/sendLightGrey.svg' : 'images/send.svg'"> {{ t('tokenItem.actions.batchTransfer') }}{{ selectedNftCount > 0 ? ` (${selectedNftCount === tokenData.nfts?.length ? t('tokenItem.actions.all') : selectedNftCount})` : '' }}
          </span>
          <span v-if="selectedNftCount > 0 || displayBatchTransfer" @click="selectAllNfts()" class="batch-action-btn">
            {{ t('tokenItem.actions.all') }}
          </span>
          <span v-if="selectedNftCount > 0 || displayBatchTransfer" @click="clearSelection()" class="batch-action-btn">
            {{ t('tokenItem.actions.clear') }}
          </span>
          <span v-if="isSingleNft && tokenData?.nfts?.[0]?.token?.nft?.capability == 'minting' && settingsStore.mintNfts" @click="displayMintNfts = !displayMintNfts">
            <img class="icon" :src="settingsStore.darkMode? 'images/hammerLightGrey.svg' : 'images/hammer.svg'"> {{ t('tokenItem.actions.mintNfts') }}
          </span>
          <span v-if="isSingleNft && settingsStore.tokenBurn" @click="displayBurnNft = !displayBurnNft" style="white-space: nowrap;">
            <img class="icon" :src="settingsStore.darkMode? 'images/fireLightGrey.svg' : 'images/fire.svg'">
            <span>{{ t('tokenItem.actions.burnNft') }}</span>
          </span>
          <span v-if="settingsStore.authchains && tokenData?.authUtxo" @click="displayAuthTransfer = !displayAuthTransfer" style="white-space: nowrap;">
            <img class="icon" :src="settingsStore.darkMode? 'images/shieldLightGrey.svg' : 'images/shield.svg'">
            <span>{{ t('tokenItem.actions.authTransfer') }}</span>
          </span>
        </div>
        <div v-if="displayTokenInfo" class="tokenAction">
          <div></div>
          <div v-if="tokenDescription" class="indentText">{{ t('tokenItem.info.tokenDescription') }} {{ tokenDescription }} </div>
          <div v-if="parseResult?.success && parseResult.namedFields?.length && parseResult.namedFields.length > 2">
            <div>{{ t('tokenItem.info.parsedFields') }}</div>
            <div v-for="(field, index) in parseResult.namedFields" :key="'parsed-field-' + index" style="white-space: pre-wrap; margin-left:15px">
              {{ field.name ?? field.fieldId ?? `Field ${index}` }}: {{ field.parsedValue?.formatted ?? field.value }}
            </div>
          </div>
          <div v-if="isSingleNft">
            {{ t('tokenItem.info.nftType') }} {{  tokenData?.nfts?.[0]?.token?.nft?.capability == "none" ? t('tokenItem.info.immutable') : tokenData?.nfts?.[0]?.token?.nft?.capability }} NFT
          </div>
          <div v-if="isSingleNft">
            {{ t('tokenItem.info.nftCommitment') }} {{ commitmentDisplay }}
          </div>
          <div v-if="tokenMetaData?.uris?.web">
            {{ t('tokenItem.info.tokenWebLink') }}
            <a :href="tokenMetaData.uris.web" target="_blank">{{ tokenMetaData.uris.web }}</a>
          </div>
          <div v-if="tokenData?.nfts?.length && !isParsable">
            {{ t('tokenItem.info.totalSupplyNfts') }} {{ totalNumberNFTs? totalNumberNFTs.toLocaleString("en-US"): "..."}}
          </div>
          <div v-if="tokenData?.nfts?.length && !isSingleMintingNft && !isParsable">
            {{ t('tokenItem.info.hasActiveMintingNft') }} {{ hasMintingNFT == undefined? "..." :( hasMintingNFT? t('tokenItem.info.yes'): t('tokenItem.info.no'))}}
          </div>
          <div>
            <a style="color: var(--font-color); cursor: pointer;" :href="'https://tokenexplorer.cash/?tokenId=' + tokenData.category" target="_blank">
              {{ t('tokenItem.info.seeDetailsOnExplorer') }} <img :src="settingsStore.darkMode? 'images/external-link-grey.svg' : 'images/external-link.svg'" style="vertical-align: sub;"/>
            </a>
          </div>
          <details v-if="isSingleNft && nftMetadata?.extensions?.attributes" style="cursor:pointer;">
            <summary style="display: list-item">{{ t('tokenItem.info.nftAttributes') }}</summary>
            <div v-for="(attributeValue, attributeKey) in nftMetadata?.extensions?.attributes" :key="((attributeValue as string) + (attributeValue as string))" style="white-space: pre-wrap; margin-left:15px">
              {{ attributeKey }}: {{ attributeValue ? attributeValue : t('tokenItem.empty') }}
            </div>
          </details>
        </div>

        <div v-if="displaySendNft" class="tokenAction">
          {{ t('tokenItem.sendNft.title') }}
          <div class="inputGroup">
            <div class="addressInputNftSend">
              <input v-model="destinationAddr" @input="parseAddrParams()" name="tokenAddress" :placeholder="t('tokenItem.sendTokens.addressPlaceholder')">
              <button v-if="settingsStore.qrScan" @click="() => showQrCodeDialog = true" style="padding: 12px">
                <img src="images/qrscan.svg" />
              </button>
            </div>
            <input @click="sendNft()" type="button" class="primaryButton" :value="activeAction === 'sending' ? t('tokenItem.sendNft.sendingButton') : t('tokenItem.sendNft.sendButton')" :disabled="activeAction !== null">
          </div>
        </div>
        <div v-if="displayBatchTransfer" class="tokenAction">
          {{ selectedNftCount === tokenData.nfts?.length ? t('tokenItem.batchTransfer.titleAll', { count: selectedNftCount }) : t('tokenItem.batchTransfer.titleSelected', { count: selectedNftCount }) }}
          <div class="inputGroup">
            <div class="addressInputNftSend">
              <input v-model="destinationAddr" @input="parseAddrParams()" name="tokenAddress" :placeholder="t('tokenItem.sendTokens.addressPlaceholder')">
              <button v-if="settingsStore.qrScan" @click="() => showQrCodeDialog = true" style="padding: 12px">
                <img src="images/qrscan.svg" />
              </button>
            </div>
            <input @click="sendBatchNfts()" type="button" class="primaryButton" :value="activeAction === 'sending' ? t('tokenItem.batchTransfer.transferringButton') : t('tokenItem.batchTransfer.transferButton')" :disabled="activeAction !== null">
          </div>
        </div>
        <div v-if="displayMintNfts" class="tokenAction">
          {{ t('tokenItem.mint.title') }}
          <div>
            <input type="checkbox" v-model="mintUniqueNfts" style="margin: 0px; vertical-align: text-bottom;">
            {{ t('tokenItem.mint.uniqueCheckbox') }}
          </div>
          <div v-if="mintUniqueNfts" style="display: flex; gap: 10px; align-items: center; margin-bottom: 5px;">
            <label for="numbering" style="width: 80px;">{{ t('tokenItem.mint.numberingLabel') }}</label>
            <select id="numbering" v-model="numberingUniqueNfts" style="max-width: 260px; padding: 4px 8px;">
              <option value="vm-numbers">{{ t('tokenItem.mint.vmNumbers') }}</option>
              <option value="hex-numbers">{{ t('tokenItem.mint.hexNumbers') }}</option>
            </select>
          </div>
          <p class="grouped" style="align-items: center; margin-bottom: 5px;">
            <input v-model="mintAmountNfts" type="number" :placeholder="t('tokenItem.mint.amountPlaceholder')">
            <input v-if="mintUniqueNfts" v-model="startingNumberNFTs" type="number" :placeholder="t('tokenItem.mint.startingNumberPlaceholder')" style="margin-right: 0px;">
            <input v-if="!mintUniqueNfts" v-model="mintCommitment" :placeholder="t('tokenItem.mint.commitmentPlaceholder')">
          </p>
          <span class="grouped">
            <input v-model="destinationAddr" @input="parseAddrParams()" :placeholder="t('tokenItem.mint.destinationPlaceholder')">
            <input @click="mintNfts()" type="button" :value="activeAction === 'minting' ? t('tokenItem.mint.mintingButton') : t('tokenItem.mint.mintButton')" class="primaryButton" :disabled="activeAction !== null">
          </span>
        </div>
        <div v-if="displayBurnNft" class="tokenAction">
          <span v-if="isSingleNft && tokenData?.nfts?.[0]?.token?.nft?.capability == 'minting'">{{ t('tokenItem.burn.burnMintingDescription') }}</span>
          <span v-else>{{ t('tokenItem.burn.burnNftDescription') }}</span>
          <br>
          <input @click="burnNft()" type="button" :value="activeAction === 'burning' ? t('tokenItem.burn.burningButton') : t('tokenItem.burn.burnNftButton')" class="button error" :disabled="activeAction !== null">
        </div>
        <div v-if="displayAuthTransfer" class="tokenAction">
          {{ t('tokenItem.authTransfer.descriptionNft') }} <br>
          <i18n-t keypath="tokenItem.authTransfer.dedicatedWalletNote" tag="span">
            <template #link>
              <a href="https://cashtokens.studio/" target="_blank">CashTokens Studio</a>
            </template>
          </i18n-t><br>
          <span class="grouped" style="margin-top: 10px;">
            <input v-model="destinationAddr" @input="parseAddrParams()" :placeholder="t('tokenItem.mint.destinationPlaceholder')">
            <input @click="transferAuth()" type="button" :value="activeAction === 'transferAuth' ? t('tokenItem.authTransfer.transferringButton') : t('tokenItem.authTransfer.transferButton')" class="primaryButton" :disabled="activeAction !== null">
          </span>
        </div>
      </div>
    </fieldset>

    <div v-if="showNftImage && (nftMetadata?.uris?.image || httpsUrlTokenIcon)">
      <dialogNftIcon :srcNftImage="nftMetadata?.uris?.image || httpsUrlTokenIcon as string" :nftName="tokenName" @close-dialog="() => showNftImage = false"/>
    </div>

    <div v-if="displayChildNfts && (tokenData.nfts?.length ?? 0) > 1">
      <div v-for="(nft, index) in tokenData.nfts" :key="'nft'+tokenData.category.slice(0,4) + index">
        <nftChild
          :nftData="nft"
          :tokenMetaData="store.bcmrRegistries?.[tokenData.category]"
          :id="'nft'+tokenData.category.slice(0,4) + index"
          :isSelected="isNftSelected(nft.txid, nft.vout)"
          @toggle-select="toggleNftSelection(nft.txid, nft.vout)"
        />
      </div>
    </div>
  </div>
  <div v-if="showQrCodeDialog">
    <QrCodeDialog @hide="() => showQrCodeDialog = false" @decode="qrDecode" :filter="qrFilter"/>
  </div>
</template>

<style scoped>
.batch-action-btn {
  margin-left: 10px;
  color: #888;
  cursor: pointer;
  font-size: 0.9em;
}
.batch-action-btn:hover {
  color: var(--color-primary);
}
.showChildNftsToggle {
  cursor: pointer;
}
.loadingChildNftMetadata {
  position: absolute;
  top: 100%;
  left: 0;
  color: grey;
  white-space: nowrap;
}
.show-mobile {
  display: none;
}
@media only screen and (max-width: 850px) {
  .showChildNfts {
    display: flex;
    flex-direction: row;
    align-items: center;
    margin-top: 0px;
  }
  .loadingChildNftMetadata {
    position: static;
    margin-left: 10px;
  }
  .hide-mobile {
    display: none;
  }
  .show-mobile {
    display: inline;
  }
}
</style>