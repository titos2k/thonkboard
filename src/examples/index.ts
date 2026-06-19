import thonkboardRaw from './thonkboard.thonk?raw'
import softwareProjectRaw from './software-project.thonk?raw'
import swotRaw from './swot.thonk?raw'
import decisionRaw from './decision.thonk?raw'
import decisionKeyQuestionsRaw from './decision-key-questions.thonk?raw'
import featureBriefRaw from './feature-brief.thonk?raw'
import premortemRaw from './pre-mortem.thonk?raw'
import firstPrinciplesRaw from './first-principles.thonk?raw'

export interface ExampleDef {
  id: string
  name: string
  description: string
  raw: string
  isTemplate?: boolean
}

export const EXAMPLES: ExampleDef[] = [
  {
    id: 'thonkboard',
    name: 'ThonkBoard',
    description: 'How ThonkBoard itself was designed',
    raw: thonkboardRaw,
  },
  {
    id: 'decision-key-questions',
    name: 'Decision Key Questions',
    description: '5W+H framework for any decision',
    raw: decisionKeyQuestionsRaw,
    isTemplate: true,
  },
  {
    id: 'decision',
    name: 'Decision Maker',
    description: 'Compare two options and their risks',
    raw: decisionRaw,
    isTemplate: true,
  },
  {
    id: 'feature-brief',
    name: 'Feature Brief',
    description: 'Scope and frame a product feature',
    raw: featureBriefRaw,
    isTemplate: true,
  },
  {
    id: 'first-principles',
    name: 'First Principles',
    description: 'Strip assumptions, rebuild from what is actually true',
    raw: firstPrinciplesRaw,
    isTemplate: true,
  },
  {
    id: 'pre-mortem',
    name: 'Pre-mortem',
    description: 'Find what could go wrong before it does',
    raw: premortemRaw,
    isTemplate: true,
  },
  {
    id: 'software-project',
    name: 'Software Project',
    description: 'Product vision, users, UI/UX, tech stack, security, and go-to-market',
    raw: softwareProjectRaw,
    isTemplate: true,
  },
  {
    id: 'swot',
    name: 'SWOT Analysis',
    description: 'Strengths, Weaknesses, Opportunities, Threats',
    raw: swotRaw,
    isTemplate: true,
  },
]
