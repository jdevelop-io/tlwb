import { describeBoardStoreContract } from '../../src/store/contract'
import { InMemoryBoardStore } from '../../src/store/memory'

describeBoardStoreContract('InMemoryBoardStore', () => new InMemoryBoardStore())
