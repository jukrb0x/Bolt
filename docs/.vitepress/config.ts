import { defineConfig } from 'vitepress'
import { extendConfig } from '@voidzero-dev/vitepress-theme/config'
import { groupIconMdPlugin, groupIconVitePlugin } from 'vitepress-plugin-group-icons'

export default extendConfig(defineConfig({
  title: 'Bolt',
  description: 'Your daily Unreal Engine workflow, automated',
  cleanUrls: true,
  
  head: [
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'Bolt' }],
    ['meta', { property: 'og:description', content: 'Your daily Unreal Engine workflow, automated' }],
    ['meta', { property: 'og:url', content: 'https://github.com/jukrb0x/Bolt' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'theme-color', content: '#3b82f6' }],
  ],
  
  themeConfig: {
    variant: 'vite',
    logo: '/logo.svg',
    siteTitle: 'Bolt',
    
    editLink: {
      pattern: 'https://github.com/jukrb0x/Bolt/edit/main/docs/:path',
      text: 'Suggest changes to this page',
    },
    
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
    
    search: {
      provider: 'local'
    },
    
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2024-present Jabriel'
    },
    
    outline: {
      level: [2, 3]
    }
  },
  
  markdown: {
    lineNumbers: true,
    theme: {
      light: 'github-light',
      dark: 'github-dark'
    },
    config(md) {
      md.use(groupIconMdPlugin, {
        titleBar: {
          includeSnippet: true
        }
      })
    }
  },
  
  vite: {
    plugins: [
      groupIconVitePlugin()
    ]
  }
}))
