// appended to run.html: self-intersection detection and solidify
{
  const parsed = soupFrom((s) => { S.box(s, 0, 0, 0, 10, 10, 10); S.box(s, 5, 5, 5, 15, 15, 15); });
  const r = run('two overlapping cubes', parsed);
  check('self-intersections detected', r.before.selfIntersections > 0 && r.after.selfIntersections > 0, 'pairs=' + r.after.selfIntersections);
  check('overlapping cubes are 2 clean shells', r.after.clean && r.after.shells === 2, sum(r.after));
  const r2 = run('two overlapping cubes, solidified', parsed, { solidify: true, solidifyResolution: 60 });
  const unionVol = 1000 + 1000 - 125;
  check('solidify unions shells', r2.after.clean && r2.after.shells === 1 && r2.after.selfIntersections === 0, sum(r2.after) + ' pairs=' + r2.after.selfIntersections);
  check('solidify volume within 3%', Math.abs(r2.after.stats.volume - unionVol) / unionVol < 0.03, r2.after.stats.volume.toFixed(1) + ' vs ' + unionVol);
}
{
  const r = run('demo part solidified', S.demoPart(), { solidify: true, solidifyResolution: 80 });
  check('demo solid clean', r.after.clean && r.after.shells === 1 && r.after.selfIntersections === 0, sum(r.after) + ' pairs=' + r.after.selfIntersections);
}
{
  const r = run('cube clean has no self-intersections', S.cube(10));
  check('no false positives', r.before.selfIntersections === 0, 'pairs=' + r.before.selfIntersections);
}
