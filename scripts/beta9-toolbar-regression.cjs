const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
 const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
 try {
  const p = browser.contexts()[0].pages().find(p => !p.url().includes('floating'));
  p.setDefaultTimeout(12000);
  const errors=[]; p.on('pageerror',e=>errors.push(String(e)));
  const api=(action,payload={})=>p.evaluate(({action,payload})=>window.__TAURI_INTERNALS__.invoke('api',{action,payload}),{action,payload});
  const root=path.resolve(__dirname,'../qa/beta9-ui');
  const boot=await api('bootstrap');
  assert.equal(path.resolve(boot.dataPath),path.join(root,'library'));
  assert.equal(boot.version,'0.3.0-beta.9');
  if (!(await api('query',{limit:100})).total) {
   await api('import',{paths:fs.readdirSync(root).filter(n=>n.endsWith('.png')).map(n=>path.join(root,n))});
   for(let i=0;i<200;i++){if((await api('import.status'))?.done)break;await p.waitForTimeout(100);}
  }
  await api('settings.save',{key:'details',value:false});
  await p.reload();
  const files=(await api('query',{limit:100})).files;
  const first=await api('file',{id:files[0].id});
  if(first.favorite){await api('files.favorite',{ids:[first.id],versions:{[first.id]:first.version},value:false});await p.reload();}
  const card=i=>p.getByRole('option',{name:files[i].name,exact:true});
  const selected=async i=>assert.equal(await card(i).getAttribute('aria-selected'),'true');
  const unselected=async i=>assert.equal(await card(i).getAttribute('aria-selected'),'false');
  for (const layout of ['瀑布流视图','列表视图']) {
   await p.getByRole('button',{name:layout,exact:true}).click();await p.waitForTimeout(400);
   await card(0).click();await selected(0);
   await card(0).click();await unselected(0);
   assert.equal(await p.locator('.selection-actions').count(),1);
   assert.equal(await p.getByRole('button',{name:'收藏',exact:true}).isDisabled(),true);
   assert.equal(await p.getByRole('combobox',{name:'文件排序'}).isVisible(),true);
   await card(0).click(); await card(1).click();await unselected(0);await selected(1);
   await card(0).click({modifiers:['Control']});await selected(0);await selected(1);
   await card(0).click({modifiers:['Control']});await unselected(0);await selected(1);
   await card(0).click();await card(2).click({modifiers:['Shift']});
   for(let i=0;i<3;i++)await selected(i);
   await p.getByRole('button',{name:'取消选择',exact:true}).click();
  }
  console.log('PASS grid/list repeated single click deselects; switching file, Ctrl toggling and Shift range remain correct');
  const labels=await p.locator('.top-leading-actions button').evaluateAll(bs=>bs.map(b=>b.getAttribute('aria-label')));
  assert.deepEqual(labels.slice(0,2),['撤销上一步','刷新文件状态']);
  assert.ok(['收拢左侧菜单','展开左侧菜单'].includes(labels[2]));
  assert.equal(await p.locator('.breadcrumb').count(),0);
  const rects=await p.locator('.top-leading-actions button').evaluateAll(bs=>bs.map(b=>b.getBoundingClientRect().left));
  assert.ok(rects[0]<rects[1]&&rects[1]<rects[2]);
  console.log('PASS top-left controls ordered undo, refresh, sidebar; redundant workspace heading removed');
  assert.ok(rects[0] < 20);
  const initialTop=await p.locator('.app-topbar').boundingBox();
  assert.equal(Math.round(initialTop.x),0);assert.equal(Math.round(initialTop.y),0);
  await p.locator('.sidebar-toggle').click();await p.waitForTimeout(350);
  assert.equal((await p.locator('.top-leading-actions button').first().boundingBox()).x,rects[0]);
  await p.locator('.sidebar-toggle').click();await p.waitForTimeout(350);
  for (const width of [960,1360]) {
    await p.setViewportSize({width,height:870});await p.waitForTimeout(250);
    for(const control of [p.getByRole('combobox',{name:'文件排序'}),p.getByRole('button',{name:'切换排序方向'}),p.locator('.selection-actions'),p.locator('.jelly-selection')]) {
      const b=await control.boundingBox();assert.ok(b.x>=0&&b.x+b.width<=width+1);
    }
  }
  const all=p.getByRole('button',{name:'全选当前结果',exact:true});
  const clear=p.getByRole('button',{name:'取消选择',exact:true});
  assert.equal(await all.isVisible(),true);assert.equal(await clear.isVisible(),true);
  assert.equal(await clear.isDisabled(),true);
  await all.click();
  await p.waitForFunction(()=>document.querySelector('button[aria-label="全选当前结果"]').getAttribute('aria-pressed')==='true');
  assert.equal(await clear.isDisabled(),false);
  assert.equal(await p.getByRole('combobox',{name:'文件排序'}).isVisible(),true);
  assert.equal(await p.getByRole('button',{name:'切换排序方向'}).isVisible(),true);
  assert.equal(await p.getByRole('button',{name:'收藏',exact:true}).isDisabled(),false);
  await clear.click();
  assert.equal(await clear.getAttribute('aria-pressed'),'true');
  assert.equal(await p.getByRole('button',{name:'收藏',exact:true}).isDisabled(),true);
  console.log('PASS persistent sorting/actions in empty and full selection; Jelly select-all/clear states; top-left remains fixed after sidebar toggle; toolbar fits 960/1360px');

  const tooltip=async (name)=>{
   await p.mouse.move(0,0);await p.waitForTimeout(160);
   const btn=p.getByRole('button',{name,exact:true});
   await btn.hover();
   const tip=p.getByRole('tooltip',{name,exact:true});
   await tip.waitFor();await p.waitForTimeout(220);
   assert.equal(await tip.textContent(),name);
   const id=await tip.getAttribute('id');assert.equal(await btn.getAttribute('aria-describedby'),id);
   const bounds=await tip.boundingBox();const viewport=p.viewportSize()||await p.evaluate(()=>({width:innerWidth,height:innerHeight}));
   assert.ok(bounds.x>=0&&bounds.x+bounds.width<=viewport.width+1);
   await p.mouse.move(0,0);await p.waitForTimeout(160);
   assert.equal(await p.getByRole('tooltip').count(),0);
  };
  for(const theme of ['light','dark']){
   await api('settings.save',{key:'theme',value:theme});await p.reload();
   await tooltip('列表视图');await tooltip('瀑布流视图');
   await card(0).click();
   for(const name of ['收藏','导出资料包','移除']){
    const btn=p.locator('.selection-actions').getByRole('button',{name,exact:true});
    assert.equal((await btn.textContent()).trim(),'');
    const style=await btn.evaluate(b=>({width:b.getBoundingClientRect().width,padding:getComputedStyle(b).padding,svg:b.querySelector('svg').getBoundingClientRect().width}));
    assert.equal(style.width,32);assert.equal(style.padding,'0px');assert.equal(style.svg,16);
    await tooltip(name);
   }
   await p.getByRole('button',{name:'导出资料包',exact:true}).hover();await p.waitForTimeout(400);
   await p.screenshot({path:path.join(root,'toolbar-'+theme+'.png')});
   await p.mouse.move(0,0);await p.waitForTimeout(160);
   await p.getByRole('button',{name:'收藏',exact:true}).click();
   await p.getByRole('button',{name:'取消收藏',exact:true}).waitFor();
   assert.equal((await api('file',{id:files[0].id})).favorite,true);
   await tooltip('取消收藏');
   await p.getByRole('button',{name:'取消收藏',exact:true}).click();
   assert.equal((await api('file',{id:files[0].id})).favorite,false);
   await p.getByRole('button',{name:'取消选择',exact:true}).click();
  }
  console.log('PASS five icon tooltips in light/dark, icon-only actions, tooltip bounds/ARIA and favorite mutation');
  await card(0).click();
  await p.getByRole('button',{name:'导出资料包',exact:true}).click();
  const exportDialog=p.getByRole('dialog',{name:'导出资料包',exact:true});
  await exportDialog.waitFor();
  assert.equal(await exportDialog.getByRole('combobox',{name:'资料包范围'}).inputValue(),'');
  assert.ok((await exportDialog.getByRole('combobox',{name:'资料包范围'}).textContent()).includes('所选 1 个文件'));
  await p.keyboard.press('Escape');await p.waitForTimeout(240);
  await p.getByRole('button',{name:'移除',exact:true}).click();
  const removeDialog=p.getByRole('dialog',{name:'从文件库移除',exact:true});
  await removeDialog.waitFor();
  await removeDialog.getByRole('button',{name:'取消',exact:true}).click();await p.waitForTimeout(240);
  assert.ok(await api('file',{id:files[0].id}));
  await p.getByRole('button',{name:'取消选择',exact:true}).click();
  console.log('PASS export icon opens selected-file dialog; remove icon opens confirmation and cancel preserves file');

  await p.getByRole('button',{name:'列表视图',exact:true}).focus();
  await p.getByRole('tooltip',{name:'列表视图',exact:true}).waitFor();
  await p.keyboard.press('Escape');await p.waitForTimeout(160);
  assert.equal(await p.getByRole('tooltip').count(),0);
  await p.emulateMedia({reducedMotion:'reduce'});
  await p.getByRole('button',{name:'瀑布流视图',exact:true}).hover();
  await p.getByRole('tooltip').waitFor();
  assert.equal(await p.getByRole('tooltip').evaluate(e=>getComputedStyle(e).animationName),'none');
  await p.mouse.move(0,0);await p.waitForTimeout(160);
  assert.equal(await p.locator('.jelly-selection button[aria-pressed="true"]').evaluate(e=>getComputedStyle(e).animationName),'none');
  await p.emulateMedia({reducedMotion:'no-preference'});
  await p.getByRole('button',{name:'瀑布流视图',exact:true}).click();
  await p.waitForTimeout(300);
  assert.deepEqual(errors,[]);
  console.log('PASS keyboard focus/Escape, reduced motion and no page errors');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
