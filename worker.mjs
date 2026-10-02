import {handleAPI} from './api/handler.mjs';
export default {async fetch(request,env){const u=new URL(request.url);if(u.pathname.startsWith('/api/'))return handleAPI(request,env);return env.ASSETS.fetch(request)}};
