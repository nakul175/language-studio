// Development/test adapter. Production exclusively uses the Sites D1 binding.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
export function localDatabase(filename=':memory:'){
  const sqlite=new DatabaseSync(filename);sqlite.exec('PRAGMA foreign_keys=ON');
  const db={sqlite,prepare(sql){return {bind(...args){return {
    async first(){const r=sqlite.prepare(sql).get(...args);return r?{...r}:null},
    async all(){return {results:sqlite.prepare(sql).all(...args).map(r=>({...r})),meta:{changes:0},success:true}},
    async run(){const r=sqlite.prepare(sql).run(...args);return {results:[],meta:{changes:Number(r.changes)},success:true}},
    _sql:sql,_args:args
  }}}},async batch(queries){
    sqlite.exec('BEGIN');
    try{const results=queries.map(q=>{
      const prepared=sqlite.prepare(q._sql);
      if(/^\s*(SELECT|WITH|PRAGMA)/i.test(q._sql))return {results:prepared.all(...q._args).map(r=>({...r})),meta:{changes:0},success:true};
      const r=prepared.run(...q._args);return {results:[],meta:{changes:Number(r.changes)},success:true};
    });sqlite.exec('COMMIT');return results}catch(error){sqlite.exec('ROLLBACK');throw error}
  }};
  if(!sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get()){
    const dir=new URL('../drizzle/',import.meta.url);
    for(const file of readdirSync(dir).filter(f=>f.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL(file,dir),'utf8'));
  }
  return db;
}
