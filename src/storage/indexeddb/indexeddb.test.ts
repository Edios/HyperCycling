import 'fake-indexeddb/auto';
import { runRepositoryContract } from '../contract';
import { createIndexedDbRepositories } from './index';

let n = 0;
runRepositoryContract('indexeddb', () => createIndexedDbRepositories(`test-db-${++n}`));
