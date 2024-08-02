import { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: () => import('pages/WalletPage.vue'),
    props: route => ({ uri: route.query.uri, addTokenId: route.redirectedFrom?.params?.tokenId })
  },
  {
    path: '/addToken/:tokenId',
    redirect: to => {
      return { path: '/' }
    }
  },
  {
    path: '/:catchAll(.*)*',
    component: () => import('pages/ErrorNotFound.vue'),
  },
];

export default routes;
