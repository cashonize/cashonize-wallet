import {
  ChaingraphAuthHeadSchema,
} from "src/utils/zodValidation";
import { i18n } from 'src/boot/i18n'
const { t } = i18n.global

async function queryChainGraph(queryReq:string, chaingraphUrl:string){
    const jsonObj = {
        "operationName": null,
        "variables": {},
        "query": queryReq
    };
    const response = await fetch(chaingraphUrl, {
        method: "POST",
        mode: "cors",
        cache: "no-cache",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        redirect: "follow",
        referrerPolicy: "no-referrer",
        body: JSON.stringify(jsonObj),
    });
    if (!response.ok) throw new Error(t('chaingraph.errors.requestFailed', { status: response.status }));
    return await response.json();
}

export async function queryAuthHead(tokenId:string, chaingraphUrl:string) {
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
  if (!transaction) throw new Error(t('chaingraph.errors.tokenNotFound'));
  return transaction;
}

export async function queryAuthHeadTxid(tokenId:string, chaingraphUrl:string){
  const authHeadObj = await queryAuthHead(tokenId, chaingraphUrl);
  const authchain = authHeadObj.authchains[0];
  if (!authchain) throw new Error(t('chaingraph.errors.authchainNotFound'));
  // hash is bytea type "\\xabcd..." - remove the "\\x" prefix (2 chars, looks like 3 due to escape notation)
  return authchain.authhead.hash.slice(2);
}

