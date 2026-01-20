// @download/blockies has no types package, so we declare the module here
// and reuse the BlockiesConfig type from @types/blockies
declare module '@download/blockies' {
  import type blockies from 'blockies';
  export function createIcon(config?: blockies.BlockiesConfig): HTMLCanvasElement;
}
