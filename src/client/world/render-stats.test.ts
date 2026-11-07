import { describe, expect, it } from 'vitest';
import { createGpuTimer } from './render-stats';

function fakeGl() {
  const st = { ready: false, disjoint: false, begun: 0, ended: 0, deleted: 0 };
  const gl = {
    QUERY_RESULT_AVAILABLE: 1,
    QUERY_RESULT: 2,
    getParameter: () => st.disjoint,
    createQuery: () => ({}),
    deleteQuery: () => void st.deleted++,
    beginQuery: () => void st.begun++,
    endQuery: () => void st.ended++,
    getQueryParameter: (_q: unknown, p: number) => (p === 1 ? st.ready : 3_000_000),
  };
  return { gl, st };
}
const ext = { TIME_ELAPSED_EXT: 7, GPU_DISJOINT_EXT: 8 };

describe('createGpuTimer', () => {
  it('is undefined without the extension', () => {
    expect(createGpuTimer({}, null)).toBeUndefined();
  });
  it('reports ms once the query is ready and keeps one query in flight', () => {
    const { gl, st } = fakeGl();
    const t = createGpuTimer(gl, ext);
    t?.begin();
    t?.end();
    expect(t?.ms).toBeNull();
    t?.begin(); // not ready: no second query
    t?.end();
    expect(st.begun).toBe(1);
    st.ready = true;
    t?.begin();
    t?.end();
    expect(t?.ms).toBe(3);
    expect(st.begun).toBe(2);
  });
  it('drops disjoint results', () => {
    const { gl, st } = fakeGl();
    const t = createGpuTimer(gl, ext);
    t?.begin();
    t?.end();
    st.ready = true;
    st.disjoint = true;
    t?.begin();
    expect(t?.ms).toBeNull();
  });
});
