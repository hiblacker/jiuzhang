import { createApp } from 'vue'
import { consoleContextKey, createConsoleContext } from './app/context'
import { pinia } from './stores'
import App from './App.vue'
import './shared/styles/base.css'

createApp(App).use(pinia).provide(consoleContextKey, createConsoleContext(pinia)).mount('#app')
