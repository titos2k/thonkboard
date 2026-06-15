import thonkboardRaw from './thonkboard.thonk?raw'

export interface ExampleDef {
  id: string
  name: string
  description: string
  raw: string
}

export const EXAMPLES: ExampleDef[] = [
  {
    id: 'thonkboard',
    name: 'ThonkBoard',
    description: 'How ThonkBoard itself was designed',
    raw: thonkboardRaw,
  },
]
