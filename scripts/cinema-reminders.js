const KEY="vivid:cinema-reminders:v1",SEEN=KEY+":seen",MAX=60;
const read=(k,f)=>{try{const v=JSON.parse(localStorage.getItem(k)||"");return v??f}catch{return f}};
const write=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch{}};
const uid=()=>crypto.randomUUID?.()||("vr"+Date.now().toString(36)+Math.random().toString(36).slice(2));
const clean=x=>String(x||"").trim().replace(/\s+/g," ").slice(0,180)||"Vivid Cinema reminder";
export function getCinemaReminders(){return read(KEY,[]).filter(x=>x&&x.id&&x.when).sort((a,b)=>new Date(a.when)-new Date(b.when))}
export function addCinemaReminder({title,when,note="",contentId="",mediaType="movie",kind="release",recurrence="none"}){
 const d=new Date(when);if(!Number.isFinite(d.getTime())||d.getTime()<=Date.now()-60000)throw Error("Choose a future release date.");
 const all=getCinemaReminders(), existing=all.find(x=>x.contentId===String(contentId)&&x.kind===kind&&!x.completed);
 if(existing)return {...existing,duplicate:true};
 const x={id:uid(),title:clean(title),note:String(note||"").slice(0,500),when:d.toISOString(),contentId:String(contentId||""),mediaType,kind,recurrence,completed:false,createdAt:Date.now()};
 write(KEY,[x,...all].slice(0,MAX));return x;
}
export function removeCinemaReminder(id){write(KEY,getCinemaReminders().filter(x=>x.id!==id))}
export function hasCinemaReminder(contentId,kind="release"){return getCinemaReminders().some(x=>x.contentId===String(contentId)&&x.kind===kind&&!x.completed)}
export async function requestCinemaNotifications(){if(!("Notification"in window))throw Error("Notifications are not available on this device.");const p=Notification.permission==="default"?await Notification.requestPermission():Notification.permission;if(p!=="granted")throw Error("Notification permission was not granted.");return p}
async function notify(r){if(!("Notification"in window)||Notification.permission!=="granted")return false;try{const reg=await navigator.serviceWorker?.getRegistration?.();if(reg?.showNotification){await reg.showNotification("Vivid Cinema",{body:r.title+" is now available.",tag:"vivid-"+r.id,renotify:false,icon:"./icons/vivid-icon.svg",badge:"./icons/vivid-icon.svg",data:{url:"title.html?id="+encodeURIComponent(r.contentId)+"&type="+encodeURIComponent(r.mediaType)}});return true}new Notification("Vivid Cinema",{body:r.title+" is now available."});return true}catch{return false}}
export async function syncCinemaReminders(){const now=Date.now(),seen=read(SEEN,{}),all=getCinemaReminders(),due=all.filter(r=>!r.completed&&new Date(r.when).getTime()<=now&&new Date(r.when).getTime()>now-7*864e5&&!seen[r.id]);let notified=0;for(const r of due){if(await notify(r)){seen[r.id]=now;const i=all.findIndex(x=>x.id===r.id);if(i>=0)all[i]={...all[i],completed:true,completedAt:now};notified++}}write(KEY,all);write(SEEN,seen);return notified}
export function addCinemaReminderToCalendar(r){
 const d=new Date(r.when),end=new Date(d.getTime()+30*60000),fmt=x=>x.toISOString().replace(/[-:]/g,"").replace(/\.\d{3}Z$/,"Z"),esc=s=>String(s||"").replace(/\\/g,"\\\\").replace(/;/g,"\\;").replace(/,/g,"\\,").replace(/\r?\n/g,"\\n");
 const ics=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Vivid Cinema//Release Reminders//EN","CALSCALE:GREGORIAN","BEGIN:VEVENT","UID:"+esc(r.id)+"@vividcinema","DTSTAMP:"+fmt(new Date()),"DTSTART:"+fmt(d),"DTEND:"+fmt(end),"SUMMARY:"+esc(r.title),"DESCRIPTION:"+esc(r.note||"Vivid Cinema release reminder"),"BEGIN:VALARM","TRIGGER:PT0M","ACTION:DISPLAY","DESCRIPTION:"+esc(r.title),"END:VALARM","END:VEVENT","END:VCALENDAR"].join("\r\n")+"\r\n";
 const url=URL.createObjectURL(new Blob([ics],{type:"text/calendar;charset=utf-8"})),a=document.createElement("a");a.href=url;a.download="vivid-"+r.id+".ics";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);return "downloaded";
}
let loop;export function startCinemaReminderLoop(){if(loop)return;syncCinemaReminders().catch(()=>{});loop=setInterval(()=>syncCinemaReminders().catch(()=>{}),15000);window.addEventListener("focus",()=>syncCinemaReminders().catch(()=>{}),{passive:true});window.addEventListener("online",()=>syncCinemaReminders().catch(()=>{}),{passive:true});}
