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
  if(!record)return alert('附件不存在或已被浏览器清理。');
  const url=URL.createObjectURL(record.blob);
  if(record.type?.startsWith('image/')){
    const dialog=$('#attachmentPreviewDialog');
    $('#attachmentPreviewTitle').textContent=record.name||'附件预览';$('#attachmentPreviewImage').src=url;
    const download=$('#downloadAttachment');download.href=url;download.download=record.name||'附件图片';dialog.dataset.objectUrl=url;
    if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');
    return;
  }
  const link=document.createElement('a');link.href=url;link.target='_blank';link.download=record.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
function closeAttachmentPreview(){
  const dialog=$('#attachmentPreviewDialog'),url=dialog.dataset.objectUrl;
  if(typeof dialog.close==='function')dialog.close();else dialog.removeAttribute('open');
  $('#attachmentPreviewImage').removeAttribute('src');$('#downloadAttachment').removeAttribute('href');delete dialog.dataset.objectUrl;
  if(url)URL.revokeObjectURL(url);
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
function formatTimeRange(start,end){
  return start?`${start}${end?`–${end}`:''}`:'';
}
function parseTimeRangeInput(raw){
  const match=String(raw||'').match(/(\d{1,2}):(\d{2})\s*[-–—至到]\s*(\d{1,2}):(\d{2})/);
  if(!match)return ['',''];
  return [`${pad(Number(match[1]))}:${match[2]}`,`${pad(Number(match[3]))}:${match[4]}`];
}
function normalizeRole(raw){
  if(/讨论|点评/.test(raw))return '讨论';
  if(/讲者|讲课|授课|演讲|分享|汇报/.test(raw))return '讲者';
  if(/主持|主席/.test(raw))return '主持';
  if(/参会/.test(raw))return '参会';
  return '';
}
function findPersonalAliases(text){
  return [...text.matchAll(/农[\u4e00-\u9fa5]{0,4}颖|农(?:老师|主任|教授|姐姐)/g)];
}
function inferPersonalRole(text){
  const roleWords='讲者|讲课|授课|演讲|分享|汇报|讨论嘉宾|讨论|点评|主持人|主持|主席|参会';
  const explicit=text.match(new RegExp('(?:邀请|请)?您(?:担任|作为|进行|参与)?[^，。\\n]{0,12}?('+roleWords+')'))
    ||text.match(new RegExp('(?:农[\\u4e00-\\u9fa5]{0,4}颖|农老师|农主任|农教授|农姐姐)(?:教授)?(?:担任|作为|进行|参与)[^，。\\n]{0,12}?('+roleWords+')'));
  if(explicit)return normalizeRole(explicit[1]);
  const aliases=findPersonalAliases(text);
  if(!aliases.length)return '';
  const roles=[...text.matchAll(new RegExp(roleWords,'g'))];
  if(!roles.length)return '';
  for(const alias of aliases){
    const rowStart=text.lastIndexOf('\n',alias.index-1)+1;
    const beforeName=text.slice(rowStart,alias.index);
    const rowRoles=[...beforeName.matchAll(new RegExp(roleWords,'g'))];
    if(rowRoles.length)return normalizeRole(rowRoles[rowRoles.length-1][0]);
  }
  let nearest=null;
  for(const alias of aliases)for(const role of roles){
    if(role.index>alias.index)continue;
    const distance=alias.index-role.index;
    if(distance<=120&&(!nearest||distance<nearest.distance))nearest={distance,word:role[0]};
  }
  return nearest?normalizeRole(nearest.word):'';
}
function inferPersonalRange(text,ranges,hasPersonalRole){
  if(!hasPersonalRole||!ranges.length)return null;
  const aliases=findPersonalAliases(text);
  if(!aliases.length)return ranges[ranges.length-1];
  let nearest=null;
  for(const alias of aliases)for(const range of ranges){
    const distance=Math.abs(alias.index-(range.index+range[0].length));
    if(distance<=180&&(!nearest||distance<nearest.distance))nearest={distance,range};
  }
  return nearest?.range||null;
}
function spatialAgendaHint(blocks){
  const words=(blocks||[]).flatMap(block=>(block.paragraphs||[]).flatMap(paragraph=>(paragraph.lines||[]).flatMap(line=>line.words||[]))).filter(word=>word.text&&word.bbox);
  if(!words.length)return '';
  const sorted=[...words].sort((a,b)=>((a.bbox.y0+a.bbox.y1)-(b.bbox.y0+b.bbox.y1))||a.bbox.x0-b.bbox.x0),rows=[];
  for(const word of sorted){
    const y=(word.bbox.y0+word.bbox.y1)/2,height=word.bbox.y1-word.bbox.y0;
    let row=rows.find(item=>Math.abs(item.y-y)<=Math.max(12,item.height*.7));
    if(!row){row={y,height,words:[]};rows.push(row)}
    row.words.push(word);row.y=(row.y*(row.words.length-1)+y)/row.words.length;row.height=Math.max(row.height,height);
  }
  rows.forEach(row=>{row.words.sort((a,b)=>a.bbox.x0-b.bbox.x0);row.text=row.words.map(word=>word.text).join('')});
  const namePattern=/农[^\n，,。；;]{0,6}颖/;
  const nameRow=rows.find(row=>namePattern.test(row.text));
  if(!nameRow)return '';
  const nameMatch=nameRow.text.match(namePattern),nameStart=nameMatch?.index||0,nameEnd=nameStart+(nameMatch?.[0].length||0);
  let characterOffset=0;
  const nameWords=nameRow.words.filter(word=>{const start=characterOffset,end=start+word.text.length;characterOffset=end;return end>nameStart&&start<nameEnd});
  const nameX=nameWords.length?nameWords.reduce((sum,word)=>sum+(word.bbox.x0+word.bbox.x1)/2,0)/nameWords.length:nameRow.words.reduce((sum,word)=>sum+(word.bbox.x0+word.bbox.x1)/2,0)/nameRow.words.length;
  const timeRows=rows.map(row=>({row,match:row.text.match(/(\d{1,2})[:：](\d{2})\s*[-–—至到]\s*(\d{1,2})[:：](\d{2})/)})).filter(item=>item.match);
  if(!timeRows.length)return '';
  const precedingTimes=timeRows.filter(item=>item.row.y<=nameRow.y+12);
  const nearestTime=(precedingTimes.length?precedingTimes.sort((a,b)=>b.row.y-a.row.y):timeRows.sort((a,b)=>Math.abs(a.row.y-nameRow.y)-Math.abs(b.row.y-nameRow.y)))[0];
  const headerWords=rows.flatMap(row=>row.words).filter(word=>/^讲\s*者$|^主\s*持$/.test(word.text));
  const speakerHeader=headerWords.find(word=>/讲/.test(word.text)),hostHeader=headerWords.find(word=>/主/.test(word.text));
  const center=word=>(word.bbox.x0+word.bbox.x1)/2;
  const inHostColumn=hostHeader&&(!speakerHeader||Math.abs(nameX-center(hostHeader))<Math.abs(nameX-center(speakerHeader)));
  const roleRows=rows.filter(row=>/分享与讨论|讨论嘉宾|讨论|讲者|讲课|授课|演讲|汇报/.test(row.text)).sort((a,b)=>Math.abs(a.y-nameRow.y)-Math.abs(b.y-nameRow.y));
  const role=inHostColumn?'主持':(roleRows.length?normalizeRole(roleRows[0].text):'');
  const [,h1,m1,h2,m2]=nearestTime.match;
  return `我的环节时间:${h1}:${m1}-${h2}:${m2}\n本人姓名:农靖颖${role?`\n我的角色:${role}`:''}`;
}
function parseSchedule(text){
  const normalized=text.replace(/：/g,':').replace(/[–—]/g,'-')
    .replace(/(\d)\s+(?=\d|[年月日\/:.-])/g,'$1')
    .replace(/([年月日\/:.-])\s+(?=\d)/g,'$1');
  const hasMeetingContext=/会议|议程|讲者|主持|讨论/.test(normalized);
  const lodging=/入住|退房|离店|房型|预订号|酒店名称|住宿地点/.test(normalized)||(!hasMeetingContext&&/酒店|宾馆|饭店|客栈|旅馆/.test(normalized));
  const trip=lodging||/出差|外出|有空去|去吗/.test(normalized);
  const datePattern='(?:\\d{4}[年\\/-])?\\d{1,2}[月\\/-]\\d{1,2}日?';
  const dateMatches=[...normalized.matchAll(new RegExp(datePattern,'g'))];
  const lodgingDate=(normalized.match(new RegExp('(?:入住|到店|入店)[^\\d]{0,12}('+datePattern+')'))||[])[1]||'';
  const labeledDate=(normalized.match(new RegExp('(?:会\\s*议\\s*(?:时\\s*间|日\\s*期)|活\\s*动\\s*(?:时\\s*间|日\\s*期))[^\\d]{0,20}('+datePattern+')','i'))||[])[1]||'';
  const ordinaryDate=(dateMatches.find(match=>!/(?:expiration|expiry|有效期|过期)[^\n]{0,30}$/i.test(normalized.slice(Math.max(0,match.index-40),match.index)))||dateMatches[0])?.[0]||'';
  const dateText=lodgingDate||labeledDate||ordinaryDate;
  const date=parseDate(dateText);
  const afternoon=/下午/.test(normalized);
  const ranges=[...normalized.matchAll(/(\d{1,2}(?:点|:)\d{0,2})\s*(?:到|至|-)\s*(\d{1,2}(?:点|:)\d{0,2})/g)];
  const labeledPersonal=(normalized.match(/我的环节时间\s*:\s*(\d{1,2}:\d{2})\s*[-至到]\s*(\d{1,2}:\d{2})/)||[]);
  const labeledRole=(normalized.match(/我的角色\s*:\s*(讲者|讨论|主持|参会)/)||[])[1]||'';
  const role=labeledRole||inferPersonalRole(normalized);
  const hasPersonalRole=Boolean(role);
  const overall=ranges.length>1?ranges[0]:(!hasPersonalRole?ranges[0]:null);
  const personal=labeledPersonal.length?labeledPersonal:inferPersonalRange(normalized,ranges,hasPersonalRole);
  const start=overall?normalizeChineseTime(overall[1],afternoon):'';
  const end=overall?normalizeChineseTime(overall[2],afternoon):'';
  const personalStart=personal?normalizeChineseTime(personal[1],afternoon):'';
  const personalEnd=personal?normalizeChineseTime(personal[2],afternoon):'';
  const topic=(normalized.match(/会议主题\s*:\s*([^\n]+)/)||[])[1];
  const labeledHotel=(normalized.match(/(?:酒店名称|入住酒店|住宿地点) *:\s*([^\n，,。]{2,50})/)||[])[1]||'';
  const genericHotel=(normalized.match(/([^\n，,。；;]{2,50}?(?:酒店|宾馆|饭店|客栈|旅馆|度假村|服务公寓))/)||[])[1]||'';
  const hotelName=(labeledHotel||genericHotel).replace(/^.*?(?:成功预订|已预订|预订|入住) */,'').replace(/^(?:您好|您) */,'').trim();
  let title=topic?.trim()||(lodging?(hotelName||'酒店住宿'):trip?'出差/外出安排':'待填写日程');
  if(!topic){const named=(normalized.match(/(?:有一个|一个)([^，。\n]*?会议)/)||[])[1];if(named)title=named.trim()}
  let location=(normalized.match(/(?:会议地点|地点)\s*:\s*([^\n]+)/)||[])[1]||'';
  const hotelAddress=lodging?((normalized.match(/(?:酒店地址|地址)\s*:\s*([^\n；;,，。]+)/)||[])[1]||''):'';
  if(lodging)location=hotelName||hotelAddress||location;
  if(!location&&hasMeetingContext&&genericHotel)location=(genericHotel.match(/([一-龥A-Za-z]{2,30}(?:酒店|宾馆|饭店|客栈|旅馆|度假村|服务公寓))$/)||[])[1]||genericHotel;
  if(!location){location=(normalized.match(/在\s*([^，。\n]{1,40}?(?:医院|酒店|宾馆|饭店|大厦|会场|会议中心|中心|大学|学院|礼堂|展馆|报告厅|会议室))(?=的|那边|有|开会|[，。\n]|$)/)||[])[1]||''}
  if(!location){location=(normalized.match(/在([^，。\n]*?)(?:的会议|那边|有一个|开会)/)||[])[1]||''}
  if(trip&&!location)location=(normalized.match(/(苏州|北京|上海|广州|深圳|杭州|天津|南京|成都|重庆|武汉|西安|广西)/)||[''])[0];
  const url=(normalized.match(/https?:\/\/[^\s)]+/)||[''])[0];
  const meetingId=((normalized.match(/(?:腾讯会议|会议\s*(?:ID|号))\s*[#:]?\s*([\d-]{6,})/i)||[])[1]||'').replace(/^-|-$/g,'');
  const people=(normalized.match(/(?:主席|相关人员)\s*[:：]?\s*([^\n]+)/)||[])[1]||'';
  const checkout=(normalized.match(new RegExp('(?:退房|离店)[^\\d]{0,12}('+datePattern+')'))||[])[1]||dateMatches[1]?.[0]||'';
  const room=(normalized.match(/(?:房型|房间类型)\s*:\s*([^\n，,。]+)/)||[])[1]||'';
  const booking=(normalized.match(/(?:预订号|订单号|确认号)\s*:\s*([^\s\n，,]+)/)||[])[1]||'';
  const notes=lodging?[hotelAddress&&`酒店地址：${hotelAddress.trim()}`,checkout&&`退房/离店：${checkout}`,room&&`房型：${room.trim()}`,booking&&`预订号：${booking}`].filter(Boolean).join('\n'):'';
  const status=/预订成功|成功预订|已确认|确认成功|已预订/.test(normalized)?'已确认':'待确认';
  return {id:uid(),title,date:date?localDate(date):'',start,end,personalStart,personalEnd,type:trip?'出差/外出':'会议',status,location:location.trim(),role,people:people.trim(),url,meetingId,notes,source:text,reminders:[1440,60,10],attachments:[],createdAt:new Date().toISOString()};
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
      html+=`<button data-date="${key}" class="${key===localDate(selectedDate)?'selected ':''}${key===localDate(new Date())?'today ':''}${has?'has-event':''}">${day}</button>`;
    }
    host.innerHTML=html+'</div>';
  } else if(viewMode==='week'){
    const monday=new Date(cursorDate);monday.setDate(monday.getDate()-((monday.getDay()+6)%7));
    const days=Array.from({length:7},(_,index)=>{const date=new Date(monday);date.setDate(monday.getDate()+index);return date});
    $('#periodTitle').textContent=`${days[0].getMonth()+1}月${days[0].getDate()}日－${days[6].getMonth()+1}月${days[6].getDate()}日`;
    host.innerHTML=`<div class="week-grid">${days.map((date,index)=>`<button data-date="${localDate(date)}" class="${localDate(date)===localDate(selectedDate)?'selected ':''}${localDate(date)===localDate(new Date())?'today ':''}${events.some(event=>event.date===localDate(date))?'has-event':''}"><small>周${WEEKDAYS[index]}</small>${date.getDate()}</button>`).join('')}</div>`;
  } else {
    $('#periodTitle').textContent=`${year}年${month+1}月`;
    host.innerHTML=`<button class="day-focus ${localDate(cursorDate)===localDate(new Date())?'today':''}" data-date="${localDate(cursorDate)}"><small>${new Intl.DateTimeFormat('zh-CN',{weekday:'long'}).format(cursorDate)}</small><br><strong>${cursorDate.getDate()}</strong></button>`;
  }
  host.querySelectorAll('[data-date]').forEach(button=>button.addEventListener('click',()=>{selectedDate=new Date(`${button.dataset.date}T12:00:00`);cursorDate=new Date(selectedDate);render()}));
}
function renderEvents(){
  $('#selectionTitle').textContent=`${selectedDate.getMonth()+1}月${selectedDate.getDate()}日 · 日程`;
  const list=events.filter(event=>event.date===localDate(selectedDate)).sort((a,b)=>(a.personalStart||a.start||'99:99').localeCompare(b.personalStart||b.start||'99:99'));
  $('#eventList').innerHTML=list.length?list.map(event=>{const personal=event.personalStart?`我的环节 ${formatTimeRange(event.personalStart,event.personalEnd)}`:'';const overall=event.start?`会议总时间 ${formatTimeRange(event.start,event.end)}`:'';const timing=[personal,overall].filter(Boolean).join(' · ')||'时间待确认';return `<article class="event ${event.type==='出差/外出'?'trip':''}" data-id="${event.id}"><i class="event-dot"></i><div><h3>${escapeHTML(event.title)} <span class="badge">${escapeHTML(event.status)}</span></h3><p>${escapeHTML(timing)} · ${escapeHTML(event.location||'地点待确认')}${event.role?' · '+escapeHTML(event.role):''}</p></div></article>`}).join(''):'<div class="empty">暂无日程</div>';
  document.querySelectorAll('.event').forEach(item=>item.addEventListener('click',()=>openEditor(events.find(event=>event.id===item.dataset.id))));
}

function resetEditor(){
  editingId=null;pendingFiles=[];$('#editorTitle').textContent='导入日程';$('#importSection').classList.remove('hidden');$('#deleteBtn').classList.add('hidden');$('#sourceText').value='';$('#ocrStatus').textContent='文字和附件只保存在此设备浏览器中。';
  fillFields({title:'',date:localDate(selectedDate),start:'',end:'',personalStart:'',personalEnd:'',type:'会议',status:'待确认',location:'',role:'',url:'',meetingId:'',people:'',notes:'',reminders:[1440,60,10],attachments:[]});
}
function fillFields(event){
  $('#titleInput').value=event.title||'';$('#dateInput').value=event.date??localDate(selectedDate);$('#personalTimeInput').value=formatTimeRange(event.personalStart,event.personalEnd);$('#meetingTimeInput').value=formatTimeRange(event.start,event.end);$('#typeInput').value=event.type||'会议';$('#statusInput').value=event.status||'待确认';$('#locationInput').value=event.location||'';document.querySelectorAll('input[name="role"]').forEach(input=>{input.checked=String(event.role||'').split(/[、,\s]+/).includes(input.value)});$('#urlInput').value=event.url||'';$('#meetingIdInput').value=event.meetingId||'';$('#peopleInput').value=event.people||'';$('#notesInput').value=event.notes||'';$('#remindersInput').value=(event.reminders||[]).join(',');renderAttachments(event.attachments||[]);
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
    let worker;
    try{
      worker=await Tesseract.createWorker('chi_sim+eng',1,{logger:message=>{if(message.status==='recognizing text')$('#ocrStatus').textContent=`正在识别第 ${index+1}/${images.length} 张截图… ${Math.round((message.progress||0)*100)}%`}});
      const result=await worker.recognize(images[index],{rotateAuto:true},{text:true,blocks:true});
      outputs.push([result.data.text,spatialAgendaHint(result.data.blocks)].filter(Boolean).join('\n'));
    }catch(error){console.error(error);outputs.push('')}finally{if(worker)await worker.terminate().catch(()=>{})}
  }
  $('#sourceText').value=[$('#sourceText').value,...outputs].filter(Boolean).join('\n\n');
  if(!outputs.some(text=>text.trim())){$('#ocrStatus').textContent='截图文字识别失败。请检查网络，或直接粘贴聊天文字。';return}
  applyRecognizedText($('#sourceText').value,`已识别 ${images.length} 张截图，请检查下方日程。`);
}
function applyRecognizedText(text,successMessage='已识别，请检查并修改后保存。'){
  const value=String(text||'').trim();
  if(!value){$('#ocrStatus').textContent='请先粘贴文字或选择截图。';return false}
  try{const draft=parseSchedule(value);draft.attachments=pendingFiles.map(file=>file.name);fillFields(draft);$('#ocrStatus').textContent=draft.date?successMessage:'未能确定日期，请手动选择日期后再保存。';$('#fields').scrollIntoView({behavior:'smooth',block:'start'});return true}
  catch(error){console.error(error);$('#ocrStatus').textContent='识别出错，请稍后重试或手动填写。';return false}
}
function eventFromForm(existing){
  const [personalStart,personalEnd]=parseTimeRangeInput($('#personalTimeInput').value),[start,end]=parseTimeRangeInput($('#meetingTimeInput').value);
  const role=[...document.querySelectorAll('input[name="role"]:checked')].map(input=>input.value).join('、');
  return {...existing,id:existing?.id||uid(),title:$('#titleInput').value.trim(),date:$('#dateInput').value,start,end,personalStart,personalEnd,type:$('#typeInput').value,status:$('#statusInput').value,location:$('#locationInput').value.trim(),role,url:$('#urlInput').value.trim(),meetingId:$('#meetingIdInput').value.trim(),people:$('#peopleInput').value.trim(),notes:$('#notesInput').value.trim(),source:existing?.source||$('#sourceText').value,reminders:$('#remindersInput').value.split(/[,，]/).map(Number).filter(value=>Number.isFinite(value)&&value>=0),attachments:pendingFiles.length?pendingFiles.map(file=>file.name):(existing?.attachments||[]),createdAt:existing?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()};
}
const normalizedMeetingId=value=>String(value||'').replace(/\D/g,'');
const canonicalUrl=value=>String(value||'').replace(/[?#].*$/,'').replace(/\/$/,'');
function findDuplicateEvent(candidate){
  const meetingId=normalizedMeetingId(candidate.meetingId),url=canonicalUrl(candidate.url);
  return events.find(item=>(meetingId&&meetingId===normalizedMeetingId(item.meetingId))||(url&&url===canonicalUrl(item.url))||(candidate.date&&candidate.date===item.date&&((candidate.start&&candidate.start===item.start&&candidate.end===item.end)||(candidate.personalStart&&candidate.personalStart===item.personalStart&&candidate.personalEnd===item.personalEnd))));
}
function joinUniqueText(first,second){return [...new Set([first,second].filter(Boolean).map(value=>String(value).trim()))].join('\n')}
function mergeEvents(existing,incoming){
  const generic=/^(?:待填写日程|出差\/外出安排|酒店住宿)$/;
  const title=!existing.title||generic.test(existing.title)?incoming.title:existing.title;
  return {...existing,title,date:existing.date||incoming.date,start:existing.start||incoming.start,end:existing.end||incoming.end,personalStart:existing.personalStart||incoming.personalStart,personalEnd:existing.personalEnd||incoming.personalEnd,type:existing.type||incoming.type,status:existing.status==='已确认'||incoming.status==='已确认'?'已确认':(existing.status||incoming.status),location:existing.location||incoming.location,role:joinUniqueText(existing.role,incoming.role).replace(/\n/g,'、'),url:existing.url||incoming.url,meetingId:existing.meetingId||incoming.meetingId,people:joinUniqueText(existing.people,incoming.people),notes:joinUniqueText(existing.notes,incoming.notes),source:joinUniqueText(existing.source,incoming.source),reminders:[...new Set([...(existing.reminders||[]),...(incoming.reminders||[])])],attachments:[...(existing.attachments||[]),...(incoming.attachments||[])],updatedAt:new Date().toISOString()};
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
  const now=Date.now();events.forEach(event=>(event.reminders||[]).forEach(offset=>{const reminderTime=event.personalStart||event.start;if(!event.date||!reminderTime)return;const target=new Date(`${event.date}T${reminderTime}:00`).getTime()-offset*60000;if(Math.abs(target-now)<30000&&!sessionStorage.getItem(`${event.id}-${offset}`)){sessionStorage.setItem(`${event.id}-${offset}`,'1');if('Notification'in window&&Notification.permission==='granted')new Notification(event.title,{body:`${reminderTime} ${event.location||''}`})}}));
}

document.querySelectorAll('.view-tabs button').forEach(button=>button.addEventListener('click',()=>{viewMode=button.dataset.view;render()}));
$('#previousBtn').addEventListener('click',()=>navigate(-1));$('#nextBtn').addEventListener('click',()=>navigate(1));
$('#addBtn').addEventListener('click',()=>openEditor());$('#importBtn').addEventListener('click',()=>openEditor());
$('#closeEditorBtn').addEventListener('click',closeEditorDialog);
$('#closeAttachmentPreview').addEventListener('click',closeAttachmentPreview);
$('#photoInput').addEventListener('change',event=>{if(event.target.files?.length)recognizeFiles(event.target.files);else $('#ocrStatus').textContent='未选择文件。'});
$('#recognizeBtn').addEventListener('click',()=>applyRecognizedText($('#sourceText').value));
$('#editorForm').addEventListener('submit',async event=>{event.preventDefault();if(!$('#titleInput').value.trim()||!$('#dateInput').value)return;const index=events.findIndex(item=>item.id===editingId);let updated=eventFromForm(index>=0?events[index]:null),merged=false;const duplicate=index<0?findDuplicateEvent(updated):null;if(duplicate){updated.id=duplicate.id;merged=true}try{const stored=await storeAttachments(updated.id,pendingFiles);if(stored)updated.attachments=stored}catch{$('#ocrStatus').textContent='附件保存失败，请减少文件大小后重试。';return}if(index>=0)events[index]=updated;else if(duplicate){const duplicateIndex=events.findIndex(item=>item.id===duplicate.id);events[duplicateIndex]=updated=mergeEvents(duplicate,updated)}else events.push(updated);persist();closeEditorDialog();selectedDate=new Date(`${updated.date}T12:00:00`);cursorDate=new Date(selectedDate);render();if(merged)alert('已识别为同一会议，文字、截图和附件已合并。');if('Notification'in window&&Notification.permission==='default')Notification.requestPermission()});
$('#deleteBtn').addEventListener('click',async()=>{if(!editingId||!confirm('确定删除这条日程吗？'))return;await deleteAttachments(editingId).catch(()=>{});events=events.filter(event=>event.id!==editingId);persist();closeEditorDialog();render()});
$('#exportBtn').addEventListener('click',exportData);$('#restoreInput').addEventListener('change',event=>event.target.files[0]&&restoreData(event.target.files[0]));

render();setInterval(checkReminders,30000);checkReminders();
if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
