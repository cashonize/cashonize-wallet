import { createIcon } from '@download/blockies';

export function appendBlockieIcon(tokenId: string, templateSelector: string) {
  const icon = createIcon({
    seed: tokenId,
    size: 12,
    scale: 4,
    spotcolor: '#000'
  });
  icon.style = "display: block; border-radius: 50%;"
  const template = document.querySelector(templateSelector);
  const iconDiv = template?.querySelector("#genericTokenIcon")
  iconDiv?.appendChild(icon);
}
