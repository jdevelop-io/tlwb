import { describe, expect, it } from 'vitest'
import * as api from '../src/index'

describe('library surface', () => {
  it('exports what a deployment composes the editor with', () => {
    expect(Object.keys(api).sort()).toEqual(
      [
        'AgentIcon',
        'BoardApp',
        'Logotype',
        'NotFound',
        'Notice',
        'ServerError',
        'clearKeys',
        'createHostedBoard',
        'keysFromFragment',
        'listRecents',
        'loadIdentity',
        'openBoardSession',
        'readAlias',
        'readKeys',
        'removeRecent',
        'renderResume',
        'saveIdentity',
        'touchRecent',
        'uploadAsset',
        'useModalDialog',
        'writeAlias',
        'writeKeys',
      ].sort(),
    )
  })
})
