import {
  ChaingraphTotalSupplyFTSchema,
  ChaingraphOutputArraySchema,
  ChaingraphAuthHeadSchema,
  type ChaingraphAuthHeadData
} from "src/utils/zodValidation";

async function queryChainGraph(queryReq:string, chaingraphUrl:string){
    const jsonObj = {
        "operationName": null,
        "variables": {},
        "query": queryReq
    };
    const response = await fetch(chaingraphUrl, {
        method: "POST",
        mode: "cors", // no-cors, *cors, same-origin
        cache: "no-cache", // *default, no-cache, reload, force-cache, only-if-cached
        credentials: "same-origin", // include, *same-origin, omit
        headers: {
            "Content-Type": "application/json",
        },
        redirect: "follow", // manual, *follow, error
        referrerPolicy: "no-referrer", // no-referrer, *no-referrer-when-downgrade, origin, origin-when-cross-origin, same-origin, strict-origin, strict-origin-when-cross-origin, unsafe-url
        body: JSON.stringify(jsonObj), // body data type must match "Content-Type" header
    });
    return await response.json();
}

export async function queryTotalSupplyFT(tokenId:string, chaingraphUrl:string){
    const queryReqTotalSupply = `query {
        transaction(
          where: {
            inputs: {
              outpoint_transaction_hash: { _eq: "\\\\x${tokenId}" }
              outpoint_index: { _eq: 0 }
            }
          }
        ) {
          outputs(where: { token_category: { _eq: "\\\\x${tokenId}" } }) {
            fungible_token_amount
          }
        }
      }`;
    const responseJson = await queryChainGraph(queryReqTotalSupply, chaingraphUrl);
    const parsed = ChaingraphTotalSupplyFTSchema.parse(responseJson);
    const transaction = parsed.data.transaction[0];
    if (!transaction) throw new Error("Token genesis transaction not found");
    const totalAmount = transaction.outputs.reduce(
        (total, output) => total + BigInt(output.fungible_token_amount),
        0n
      );
    return totalAmount;
}

export async function queryActiveMinting(tokenId:string, chaingraphUrl:string){
    const queryReqActiveMinting = `query {
        output(
          where: {
            token_category: { _eq: "\\\\x${tokenId}" }
            _and: { nonfungible_token_capability: { _eq: "minting" } }
            _not: { spent_by: {} }
          }
        ) {
          locking_bytecode
        }
      }`;
    const responseJson = await queryChainGraph(queryReqActiveMinting, chaingraphUrl);
    const parsed = ChaingraphOutputArraySchema.parse(responseJson);
    return parsed.data.output.length;
}

export async function querySupplyNFTs(tokenId:string, chaingraphUrl:string){
  let offset = 0;
  async function querySupplyNFTsOffset(offset=0): Promise<number> {
    const queryReqTotalSupply = `query {
        output(
          offset: ${offset}
          where: {
            token_category: {
              _eq: "\\\\x${tokenId}"
            }
            _and: [
              { nonfungible_token_capability: { _eq: "none" } }
            ]
            _not: { spent_by: {} }
          }
        ) {
          locking_bytecode
        }
    }`;
    const responseJson = await queryChainGraph(queryReqTotalSupply, chaingraphUrl);
    const parsed = ChaingraphOutputArraySchema.parse(responseJson);
    return parsed.data.output.length;
  }
  let resultFetchSupplyNFTs = await querySupplyNFTsOffset();
  let supplyNFTs = resultFetchSupplyNFTs;
  // limit of items returned by chaingraph query is 5000
  while (resultFetchSupplyNFTs === 5000) {
    offset += 5000;
    resultFetchSupplyNFTs = await querySupplyNFTsOffset(offset);
    supplyNFTs += resultFetchSupplyNFTs;
  }
  return supplyNFTs;
}

export async function queryAuthHead(tokenId:string, chaingraphUrl:string): Promise<ChaingraphAuthHeadData> {
  const queryReqAuthHead = `query {
    transaction(
      where: {
        hash: {
          _eq: "\\\\x${tokenId}"
        }
      }
    ) {
      authchains {
        authhead {
          hash,
          identity_output {
            fungible_token_amount
          }
        }
      }
    }
  }`;
  const jsonRespAuthHead = await queryChainGraph(queryReqAuthHead, chaingraphUrl);
  const parsed = ChaingraphAuthHeadSchema.parse(jsonRespAuthHead);
  const transaction = parsed.data.transaction[0];
  if (!transaction) throw new Error("Token not found");
  return transaction;
}

export async function queryAuthHeadTxid(tokenId:string, chaingraphUrl:string){
  const authHeadObj = await queryAuthHead(tokenId, chaingraphUrl);
  const authchain = authHeadObj.authchains[0];
  if (!authchain) throw new Error("Authchain not found");
  // hash is bytea type "\\xabcd..." - remove the "\\x" prefix
  return authchain.authhead.hash.slice(2);
}

export async function queryReservedSupply(tokenId:string, chaingraphUrl:string){
  const authHeadObj = await queryAuthHead(tokenId, chaingraphUrl);
  const authchain = authHeadObj.authchains[0];
  if (!authchain) throw new Error("Authchain not found");
  const reservedSupply = authchain.authhead.identity_output[0]?.fungible_token_amount;
  return reservedSupply ? BigInt(reservedSupply) : undefined;
}
