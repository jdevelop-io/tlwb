import { listRecents } from '../board/session/recents'
import { renderResume } from './recents'

const target = document.getElementById('resume')
if (target) {
  renderResume(target, listRecents())
}
