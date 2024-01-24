import { defineStore } from "pinia"
import { ref } from 'vue'

const defaultChaingraph = "https://gql.chaingraph.pat.mn/v1/graphql";
const dafaultIpfsGateway = "https://ipfs.io/ipfs/";

export const useSettingsStore = defineStore('settingsStore', () => {

  // Global settings
  const bchUnit = ref("bch" as ("bch" | "sat"));
  const chaingraph = ref(defaultChaingraph);
  const ipfsGateway = ref(dafaultIpfsGateway);
  const darkMode  = ref(false);
  const tokenBurn = ref(false);

  // read local storage
  const readUnit = localStorage.getItem("unit");
  const readDarkMode = localStorage.getItem("darkMode");
  if(readUnit && (readUnit=="bch" || readUnit=="sat")) bchUnit.value = readUnit;
  if(readDarkMode == "true"){
    document.body.classList.add("dark");
    darkMode.value = true;
  }

  return { bchUnit, chaingraph, ipfsGateway, darkMode, tokenBurn }
})