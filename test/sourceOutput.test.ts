import { describe, expect, it } from 'vitest'
import { binToHex } from '@bitauth/libauth'
import { outputOfRawTransaction } from '../src/utils/dapp/sourceOutput'

// A mainnet transaction (5b721c7749ce8512297783478a4e4fa2032805b9406556d2079047c7c9c7bfa0) whose output 1 is an NFT; the expected values are what
// electrum's verbose form of it reports for that output
const rawHex = [
  '0200000001a35118e01362cd233b70486f7abe90254a183f31a216b9c0b391298c7c1332ad01000000fdd101514dcd01',
  '76009c63c0009dc3529dc453a169527903000001a16978028813a26900ce20d7ff0a63d5c1cbe1ced509314fe3caca56',
  '3a73095be37734744c40dbce6e2f24527e8851ce008851c70376a91455797e0288ac7e885279528051d2557a00011280',
  '7e7b7e8800cf527f7500cc00c67b81939d00cd00c78800d100ce8800d200cf8878537a950400e1f505967651a26900d3',
  '00d05279949d51cd00c78851d100ce01207f75517e8851cc537a9d51d39dc4539c6352cd51c78852d100886875516776',
  '519c63c0009dc3519dc4539d00ce20d7ff0a63d5c1cbe1ced509314fe3caca563a73095be37734744c40dbce6e2f2451',
  '7e8800cf01267f7781b27500cf01147f750376a9147c7e0288ac7e00cd788800d100ce01207f758800cc02e8039d00d3',
  '00d09d51cd788851d100ce01207f758851cc02e8039d02000000d07e51d28852cd8852d1008852cc00c602b80b949c77',
  '67529dc0009dc3529dc4529d00ce20d7ff0a63d5c1cbe1ced509314fe3caca563a73095be37734744c40dbce6e2f2452',
  '7e8851ce008800cf01147f770376a9147c7e0288ac7e51c78851d1008851cc00c651c69302d007949d00cd00c78800d1',
  '00ce8800cc02e8039d00d300d09d00cf527f7700d27b52807b7e8768680600000003e8030000000000003cefd7ff0a63',
  'd5c1cbe1ced509314fe3caca563a73095be37734744c40dbce6e2f24100376a9148ee26d6c9f58369f94864dc3630cde',
  'b17fae2f2d88ace8030000000000003fefd7ff0a63d5c1cbe1ced509314fe3caca563a73095be37734744c40dbce6e2f',
  '24600300000376a9148ee26d6c9f58369f94864dc3630cdeb17fae2f2d88acc8e4fa02000000001976a9148ee26d6c9f',
  '58369f94864dc3630cdeb17fae2f2d88ac00000000',
].join('')

describe('outputOfRawTransaction', () => {
  it('returns the spent output as electrum reports it, with exact satoshis', () => {
    const output = outputOfRawTransaction(rawHex, 1)
    expect(output.valueSatoshis).toBe(1000n)
    expect(binToHex(output.lockingBytecode)).toBe('76a9148ee26d6c9f58369f94864dc3630cdeb17fae2f2d88ac')
    // in display order, as electrum's tokenData.category, not the reversed order on the wire
    expect(binToHex(output.token!.category)).toBe('242f6ecedb404c743477e35b09733a56cacae34f3109d5cee1cbc1d5630affd7')
    expect(output.token!.amount).toBe(0n)
    expect(output.token!.nft!.capability).toBe('none')
    expect(binToHex(output.token!.nft!.commitment)).toBe('000003')
  })

  it('refuses an outpoint past the transaction\'s outputs', () => {
    expect(() => outputOfRawTransaction(rawHex, 99)).toThrow('no output 99')
  })
})
