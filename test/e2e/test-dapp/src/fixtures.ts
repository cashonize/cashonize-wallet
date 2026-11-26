// Transaction fixture from test/fixtures/wcFixtures.ts (cashNinjaJsonString0), with broadcast: false.
// The extended-JSON strings are the WC2-BCH wire form; the extension's provider carries the same
// object without the WalletConnect relay.
export const txFixture = {
  transaction: '02000000021662e68cb471cef702a3f0bc5227737887ce790714e7c45ffb6f215ef01b806200000000a7004ca4028713141b07ddefd36439f60bf596c4f891f8f6ce3dbe20011903404b4c5479009c63c0009d00cf8176557aa169c453a16900cd00c78800d100ce8876537a9300d28800cc00c6537a939d51cc02e8039d51d28800ce01207f7551d188c4539c6352d10088686d5167547a519d5579a9537a88537a547aadc3519d00cf81537aa163c4529d00cd00c78800d100ce8800d200cf8851d1008867c4519d00d10088686d5168feffffffd94402d4efa7621faee88109bd4f9044f4d87f47cf0a60170a58ce8ae4a71ed10000000000feffffff03284f4c000000000048efacd8c6620010efc41558a398a6bf2e90ea3a32ef4a3840c392237ca01054a9776202f406aa203e7393b927649d62674dfa9883b0faa27188730ee7b4086fa5861b2df915142a87e8030000000000003eefacd8c6620010efc41558a398a6bf2e90ea3a32ef4a3840c392237ca01054a9776002db0676a9148ee26d6c9f58369f94864dc3630cdeb17fae2f2d88acbf50bf07000000001976a9148ee26d6c9f58369f94864dc3630cdeb17fae2f2d88ac00000000',
  sourceOutputs: [
    {
      outpointIndex: 0,
      outpointTransactionHash: '<Uint8Array: 0x62801bf05e216ffb5fc4e7140779ce8778732752bcf0a302f7ce71b48ce66216>',
      sequenceNumber: 4294967294,
      unlockingBytecode: '<Uint8Array: 0x004ca4028713141b07ddefd36439f60bf596c4f891f8f6ce3dbe20011903404b4c5479009c63c0009d00cf8176557aa169c453a16900cd00c78800d100ce8876537a9300d28800cc00c6537a939d51cc02e8039d51d28800ce01207f7551d188c4539c6352d10088686d5167547a519d5579a9537a88537a547aadc3519d00cf81537aa163c4529d00cd00c78800d100ce8800d200cf8851d1008867c4519d00d10088686d5168>',
      lockingBytecode: '<Uint8Array: 0xaa203e7393b927649d62674dfa9883b0faa27188730ee7b4086fa5861b2df915142a87>',
      valueSatoshis: '<bigint: 1000n>',
      token: {
        amount: '<bigint: 0n>',
        category: '<Uint8Array: 0x77a95410a07c2392c340384aef323aea902ebfa698a35815c4ef100062c6d8ac>',
        nft: {
          capability: 'minting',
          commitment: '<Uint8Array: 0xdb06>',
        },
      },
    },
    {
      outpointIndex: 0,
      outpointTransactionHash: '<Uint8Array: 0xd11ea7e48ace580a17600acf477fd8f444904fbd0981e8ae1f62a7efd40244d9>',
      sequenceNumber: 4294967294,
      unlockingBytecode: '<Uint8Array: 0x>',
      lockingBytecode: '<Uint8Array: 0x76a9148ee26d6c9f58369f94864dc3630cdeb17fae2f2d88ac>',
      valueSatoshis: '<bigint: 134980559n>',
    },
  ],
  broadcast: false,
  userPrompt: 'Test transaction',
}
