import { defineConfig } from 'vitepress'
import { extendConfig } from '@voidzero-dev/vitepress-theme/config'

export default extendConfig(defineConfig({
  title: 'Bolt',
  description: 'Your daily Unreal Engine workflow, automated',
  
  themeConfig: {
    variant: 'vite',
    logo: '/logo.svg',
    siteTitle: 'Bolt',
    
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Tutorial', link: '/tutorial/getting-started' },
      { text: 'API Reference', link: '/api/overview' },
      { text: 'Guides', link: '/guides/architecture' }
    ],
    
    sidebar: {
      '/tutorial/': [
        {
          text: 'Tutorial',
          items: [
            { text: 'Getting Started', link: '/tutorial/getting-started' },
            { text: 'Installation', link: '/tutorial/installation' },
            { text: 'First Workflow', link: '/tutorial/first-workflow' },
            { text: 'Custom Ops', link: '/tutorial/custom-ops' },
            { text: 'Plugins', link: '/tutorial/plugins' }
          ]
        }
      ],
      '/api/': [
        {
          text: 'API Reference',
          items: [
            { text: 'Overview', link: '/api/overview' },
            { text: 'Configuration', link: '/api/config' },
            { text: 'Commands', link: '/api/commands' },
            { text: 'Handlers', link: '/api/handlers' },
            { text: 'Plugin API', link: '/api/plugin-api' }
          ]
        }
      ],
      '/guides/': [
        {
          text: 'Guides',
          items: [
            { text: 'Architecture', link: '/guides/architecture' },
            { text: 'Runner Internals', link: '/guides/runner' },
            { text: 'Release Process', link: '/guides/release' }
          ]
        }
      ]
    },
    
    socialLinks: [
      { icon: 'github', link: 'https://github.com/jukrb0x/Bolt' }
    ],
    
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2024-present Jabriel'
    }
  },
  
  markdown: {
    lineNumbers: true
  }
}))
