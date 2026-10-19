import { createApp } from 'vue'
import { createPinia } from 'pinia'
import Antd from 'ant-design-vue'
import 'ant-design-vue/dist/reset.css'
import './styles/proto.css'
import './styles/overrides.css'
import './styles/entry.css'
import App from './App.vue'
import { router } from './router'

createApp(App).use(createPinia()).use(router).use(Antd).mount('#app')
