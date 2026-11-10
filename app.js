'use strict';

const STORAGE_KEY = 'nong-calendar-events-v3';
const WEEKDAYS = ['一','二','三','四','五','六','日'];
const $ = selector => document.querySelector(selector);
const pad = value => String(value).padStart(2, '0');
const localDate = date => `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
const uid = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));

let events = loadEvents();
let selectedDate = new Date();
let cursorDate = new Date();
let viewMode = 'month';
let editingId = null;
let pendingFiles = [];
function showEditorDialog(){const dialog=$('#editorDialog');if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','')}
function closeEditorDialog(){const dialog=$('#editorDialog');if(typeof dialog.close==='function')dialog.close();else dialog.removeAttribute('open')}

function openAttachmentDB(){
  return new Promise((resolve,reject)=>{const request=indexedDB.open('nong-calendar-files',1);request.onupgradeneeded=()=>request.result.createObjectStore('files',{keyPath:'id'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
}
async function storeAttachments(eventId,files){
  if(!files.length)return null;
  const database=await openAttachmentDB(),transaction=database.transaction('files','readwrite'),store=transaction.objectStore('files');
  const metadata=files.map((file,index)=>{const id=`${eventId}:${Date.now()}:${index}`;store.put({id,eventId,name:file.name,type:file.type,blob:file});return{id,name:file.name,type:file.type}});
  await new Promise((resolve,reject)=>{transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error)});database.close();return metadata;
}
async function openAttachment(id){
  const database=await openAttachmentDB(),transaction=database.transaction('files','readonly'),request=transaction.objectStore('files').get(id);
  const record=await new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});database.close();
  if(!record)return alert('附件不存在或已被浏览器清理。');const url=URL.createObjectURL(record.blob),link=document.createElement('a');link.href=url;link.download=record.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function deleteAttachments(eventId){
  const database=await openAttachmentDB(),transaction=database.transaction('files','readwrite'),store=transaction.objectStore('files'),request=store.openCursor();
  request.onsuccess=()=>{const cursor=request.result;if(!cursor)return;if(cursor.value.eventId===eventId)cursor.delete();cursor.continue()};await new Promise((resolve,reject)=>{transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error)});database.close();
}

function loadEvents(){
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
  catch { return []; }
}
function persist(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(events)); }
function parseDate(raw){
  if(!raw) return null;
  const match=String(raw).match(/(?:(\d{4})[年\/-])?(\d{1,2})[月\/-](\d{1,2})日?/);
  if(!match) return null;
  const year=Number(match[1]||new Date().getFullYear()), month=Number(match[2]), day=Number(match[3]);
  const date=new Date(year,month-1,day);
  return date.getFullYear()===year&&date.getMonth()===month-1&&date.getDate()===day?date:null;
}
function normalizeChineseTime(raw, isAfternoon=false){
  const match=String(raw).match(/(\d{1,2})(?:点|:)(\d{0,2})/); if(!match)return '';
  let hour=Number(match[1]); const minute=Number(match[2]||0);
  if(isAfternoon&&hour<12)hour+=12;
  return `${pad(hour)}:${pad(minute)}`;
}
function parseSchedule(text){
  const normalized=text.replace(/：/g,':').replace(/[–—]/g,'-');
  const trip=/出差|外出|有空去|去吗/.test(normalized);
  const dateText=(normalized.match(/(?:\d{4}[年\/-])?\d{1,2}[月\/-]\d{1,2}日?/)||[''])[0];
  const date=parseDate(dateText);
  const afternoon=/下午/.test(normalized);
  const ranges=[...normalized.matchAll(/(\d{1,2}(?:点|:)\d{0,2})\s*(?:到|至|-)\s*(\d{1,2}(?:点|:)\d{0,2})/g)];
  const personal=/讲者|讲课|主持|讨论|汇报/.test(normalized)&&ranges.length>1?ranges[ranges.length-1]:ranges[0];
  const start=personal?normalizeChineseTime(personal[1],afternoon):'';
  const end=personal?normalizeChineseTime(personal[2],afternoon):'';
  const topic=(normalized.match(/会议主题\s*:\s*([^\n]+)/)||[])[1];
  let title=topic?.trim()||(trip?'出差/外出安排':'待填写日程');
  if(!topic){const named=(normalized.match(/(?:有一个|一个)([^，。\n]*?会议)/)||[])[1];if(named)title=named.trim()}
  let location=(normalized.match(/(?:会议地点|地点)\s*:\s*([^\n]+)/)||[])[1]||'';
  if(!location){location=(normalized.match(/在([^，。\n]*?)(?:的会议|那边|有一个|开会)/)||[])[1]||''}
  if(trip&&!location)location=(normalized.match(/(苏州|北京|上海|广州|深圳|杭州|天津|南京|成都|重庆|武汉|西安|广西)/)||[''])[0];
  const role=(normalized.match(/讲者|讲课|主持|讨论|汇报|参会/)||[''])[0].replace('讲课','讲者');
  const url=(normalized.match(/https?:\/\/[^\s)]+/)||[''])[0];
  const people=(normalized.match(/(?:主席|相关人员)\s*[:：]?\s*([^\n]+)/)||[])[1]||'';
  return {id:uid(),title,date:date?localDate(date):localDate(selectedDate),start,end,type:trip?'出差/外出':'会议',status:'待确认',location:location.trim(),role,people:people.trim(),url,notes:'',source:text,reminders:[1440,60,10],attachments:[],createdAt:new Date().toISOString()};
}

function render(){
  $('#todayLabel').textContent=new Intl.DateTimeFormat('zh-CN',{dateStyle:'full'}).format(new Date());
  document.querySelectorAll('.view-tabs button').forEach(button=>button.classList.toggle('active',button.dataset.view===viewMode));
  renderCalendar(); renderEvents();
}
function renderCalendar(){
  const host=$('#calendarView'),year=cursorDate.getFullYear(),month=cursorDate.getMonth();
  if(viewMode==='month'){
    $('#periodTitle').textContent=`${year}年${month+1}月`;
    const offset=(new Date(year,month,1).getDay()+6)%7;
    let html=`<div class="weekdays">${WEEKDAYS.map(day=>`<span>${day}</span>`).join('')}</div><div class="month-grid">${'<span></span>'.repeat(offset)}`;
    for(let day=1;day<=new Date(year,month+1,0).getDate();day++){
      const date=new Date(year,month,day),key=localDate(date),has=events.some(event=>event.date===key);
      html+=`<button data-date="${key}" class="${key===localDate(selectedDate)?'selected ':''}${has?'has-event':''}">${day}</button>`;
    }
    host.innerHTML=html+'</div>';
  } else if(viewMode==='week'){
    const monday=new Date(cursorDate);monday.setDate(monday.getDate()-((monday.getDay()+6)%7));
    const days=Array.from({length:7},(_,index)=>{const date=new Date(monday);date.setDate(monday.getDate()+index);return date});
    $('#periodTitle').textContent=`${days[0].getMonth()+1}月${days[0].getDate()}日－${days[6].getMonth()+1}月${days[6].getDate()}日`;
    host.innerHTML=`<div class="week-grid">${days.map((date,index)=>`<button data-date="${localDate(date)}" class="${localDate(date)===localDate(selectedDate)?'selected ':''}${events.some(event=>event.date===localDate(date))?'has-event':''}"><small>周${WEEKDAYS[index]}</small>${date.getDate()}</button>`).join('')}</div>`;
  } else {
    $('#periodTitle').textContent=`${year}年${month+1}月`;
    host.innerHTML=`<button class="day-focus" data-date="${localDate(cursorDate)}"><small>${new Intl.DateTimeFormat('zh-CN',{weekday:'long'}).format(cursorDate)}</small><br><strong>${cursorDate.getDate()}</strong></button>`;
  }
  host.querySelectorAll('[data-date]').forEach(button=>button.addEventListener('click',()=>{selectedDate=new Date(`${button.dataset.date}T12:00:00`);cursorDate=new Date(selectedDate);render()}));
}
function renderEvents(){
  $('#selectionTitle').textContent=`${selectedDate.getMonth()+1}月${selectedDate.getDate()}日 · 日程`;
  const list=events.filter(event=>event.date===localDate(selectedDate)).sort((a,b)=>(a.start||'99:99').localeCompare(b.start||'99:99'));
  $('#eventList').innerHTML=list.length?list.map(event=>`<article class="event ${event.type==='出差/外出'?'trip':''}" data-id="${event.id}"><i class="event-dot"></i><div><h3>${escapeHTML(event.title)} <span class="badge">${escapeHTML(event.status)}</span></h3><p>${escapeHTML(event.start?`${event.start}${event.end?'–'+event.end:''}`:'时间待确认')} · ${escapeHTML(event.location||'地点待确认')}${event.role?' · '+escapeHTML(event.role):''}</p></div></article>`).join(''):'<div class="empty">暂无日程</div>';
  document.querySelectorAll('.event').forEach(item=>item.addEventListener('click',()=>openEditor(events.find(event=>event.id===item.dataset.id))));
}

function resetEditor(){
  editingId=null;pendingFiles=[];$('#editorTitle').textContent='导入日程';$('#importSection').classList.remove('hidden');$('#deleteBtn').classList.add('hidden');$('#sourceText').value='';$('#ocrStatus').textContent='文字和附件只保存在此设备浏览器中。';
  fillFields({title:'',date:localDate(selectedDate),start:'',end:'',type:'会议',status:'待确认',location:'',role:'',url:'',people:'',notes:'',reminders:[1440,60,10],attachments:[]});
}
function fillFields(event){
  $('#titleInput').value=event.title||'';$('#dateInput').value=event.date||localDate(selectedDate);$('#startInput').value=event.start||'';$('#endInput').value=event.end||'';$('#typeInput').value=event.type||'会议';$('#statusInput').value=event.status||'待确认';$('#locationInput').value=event.location||'';$('#roleInput').value=event.role||'';$('#urlInput').value=event.url||'';$('#peopleInput').value=event.people||'';$('#notesInput').value=event.notes||'';$('#remindersInput').value=(event.reminders||[]).join(',');renderAttachments(event.attachments||[]);
}
function openEditor(event=null){
  resetEditor();
  if(event){editingId=event.id;$('#editorTitle').textContent='编辑日程';$('#importSection').classList.add('hidden');$('#deleteBtn').classList.remove('hidden');fillFields(event)}
  showEditorDialog();
}
function renderAttachments(items){
  $('#attachmentList').innerHTML=items.map(item=>{const entry=typeof item==='string'?{name:item}:item;return `<button type="button" class="attachment-chip" ${entry.id?`data-attachment="${escapeHTML(entry.id)}"`:''}>${escapeHTML(entry.name)}</button>`}).join('');
  document.querySelectorAll('[data-attachment]').forEach(button=>button.addEventListener('click',()=>openAttachment(button.dataset.attachment)));
}
async function recognizeFiles(files){
  pendingFiles=[...files];renderAttachments(pendingFiles.map(file=>file.name));
  $('#ocrStatus').textContent=`已选择 ${pendingFiles.length} 个文件，正在准备识别…`;
  const images=pendingFiles.filter(file=>file.type.startsWith('image/'));
  if(!images.length){$('#ocrStatus').textContent=`已选择 ${pendingFiles.length} 个附件。`;return}
  if(!window.Tesseract){$('#ocrStatus').textContent='OCR 模块未加载。附件仍可保存，请粘贴文字后识别。';return}
  const outputs=[];
  for(let index=0;index<images.length;index++){
    $('#ocrStatus').textContent=`正在本地识别第 ${index+1}/${images.length} 张截图…`;
    try{const result=await Tesseract.recognize(images[index],'chi_sim+eng',{logger:message=>{if(message.status==='recognizing text')$('#ocrStatus').textContent=`正在识别第 ${index+1}/${images.length} 张截图… ${Math.round((message.progress||0)*100)}%`}});outputs.push(result.data.text)}catch(error){console.error(error);outputs.push('')}
  }
  $('#sourceText').value=[$('#sourceText').value,...outputs].filter(Boolean).join('\n\n');
  if(!outputs.some(text=>text.trim())){$('#ocrStatus').textContent='截图文字识别失败。请检查网络，或直接粘贴聊天文字。';return}
  applyRecognizedText($('#sourceText').value,`已识别 ${images.length} 张截图，请检查下方日程。`);
}
function applyRecognizedText(text,successMessage='已识别，请检查并修改后保存。'){
  const value=String(text||'').trim();
  if(!value){$('#ocrStatus').textContent='请先粘贴文字或选择截图。';return false}
  try{const draft=parseSchedule(value);draft.attachments=pendingFiles.map(file=>file.name);fillFields(draft);$('#ocrStatus').textContent=successMessage;$('#fields').scrollIntoView({behavior:'smooth',block:'start'});return true}
  catch(error){console.error(error);$('#ocrStatus').textContent='识别出错，请稍后重试或手动填写。';return false}
}
function eventFromForm(existing){
  return {...existing,id:existing?.id||uid(),title:$('#titleInput').value.trim(),date:$('#dateInput').value,start:$('#startInput').value,end:$('#endInput').value,type:$('#typeInput').value,status:$('#statusInput').value,location:$('#locationInput').value.trim(),role:$('#roleInput').value.trim(),url:$('#urlInput').value.trim(),people:$('#peopleInput').value.trim(),notes:$('#notesInput').value.trim(),source:existing?.source||$('#sourceText').value,reminders:$('#remindersInput').value.split(/[,，]/).map(Number).filter(value=>Number.isFinite(value)&&value>=0),attachments:pendingFiles.length?pendingFiles.map(file=>file.name):(existing?.attachments||[]),createdAt:existing?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()};
}
function navigate(direction){
  if(viewMode==='month')cursorDate=new Date(cursorDate.getFullYear(),cursorDate.getMonth()+direction,1);
  else if(viewMode==='week')cursorDate.setDate(cursorDate.getDate()+direction*7);
  else cursorDate.setDate(cursorDate.getDate()+direction);
  selectedDate=new Date(cursorDate);render();
}
function exportData(){
  const blob=new Blob([JSON.stringify({version:3,exportedAt:new Date().toISOString(),events},null,2)],{type:'application/json'}),link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=`农的日程-${localDate(new Date())}.json`;link.click();URL.revokeObjectURL(link.href);
}
async function restoreData(file){
  try{const payload=JSON.parse(await file.text());if(!Array.isArray(payload.events))throw new Error();events=payload.events;persist();render();alert('备份已恢复')}catch{alert('备份文件无效')}
}
function checkReminders(){
  const now=Date.now();events.forEach(event=>(event.reminders||[]).forEach(offset=>{if(!event.date||!event.start)return;const target=new Date(`${event.date}T${event.start}:00`).getTime()-offset*60000;if(Math.abs(target-now)<30000&&!sessionStorage.getItem(`${event.id}-${offset}`)){sessionStorage.setItem(`${event.id}-${offset}`,'1');if('Notification'in window&&Notification.permission==='granted')new Notification(event.title,{body:`${event.start} ${event.location||''}`})}}));
}

document.querySelectorAll('.view-tabs button').forEach(button=>button.addEventListener('click',()=>{viewMode=button.dataset.view;render()}));
$('#previousBtn').addEventListener('click',()=>navigate(-1));$('#nextBtn').addEventListener('click',()=>navigate(1));
$('#addBtn').addEventListener('click',()=>openEditor());$('#importBtn').addEventListener('click',()=>openEditor());
$('#closeEditorBtn').addEventListener('click',closeEditorDialog);
$('#photoInput').addEventListener('change',event=>{if(event.target.files?.length)recognizeFiles(event.target.files);else $('#ocrStatus').textContent='未选择文件。'});
$('#recognizeBtn').addEventListener('click',()=>applyRecognizedText($('#sourceText').value));
$('#editorForm').addEventListener('submit',async event=>{event.preventDefault();if(!$('#titleInput').value.trim()||!$('#dateInput').value)return;const index=events.findIndex(item=>item.id===editingId);const updated=eventFromForm(index>=0?events[index]:null);try{const stored=await storeAttachments(updated.id,pendingFiles);if(stored)updated.attachments=stored}catch{$('#ocrStatus').textContent='附件保存失败，请减少文件大小后重试。';return}if(index>=0)events[index]=updated;else events.push(updated);persist();closeEditorDialog();selectedDate=new Date(`${updated.date}T12:00:00`);cursorDate=new Date(selectedDate);render();if('Notification'in window&&Notification.permission==='default')Notification.requestPermission()});
$('#deleteBtn').addEventListener('click',async()=>{if(!editingId||!confirm('确定删除这条日程吗？'))return;await deleteAttachments(editingId).catch(()=>{});events=events.filter(event=>event.id!==editingId);persist();closeEditorDialog();render()});
$('#exportBtn').addEventListener('click',exportData);$('#restoreInput').addEventListener('change',event=>event.target.files[0]&&restoreData(event.target.files[0]));

render();setInterval(checkReminders,30000);checkReminders();
if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
