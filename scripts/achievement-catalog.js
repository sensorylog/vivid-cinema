const list=(l,k)=>Array.isArray(l?.[k])?l[k]:[];
const count=(l,k)=>list(l,k).length;
const type=i=>i?.media_type||i?.mediaType||"movie";
const unique=a=>[...new Map(a.map(i=>[type(i)+":"+i.id,i])).values()];
const all=l=>["favorites","watchLater","history"].flatMap(k=>list(l,k).filter(i=>i?.id!=null));
const finished=l=>list(l,"history").filter(i=>Number(i?.completion||0)>=100||Number(i?.completedAt||0)>0||i?.completed===true);
export const ACHIEVEMENTS=[
{id:"first-favorite",title:"First Love",category:"Your library",description:"Save a title you want to keep close.",icon:"♥",target:1,unit:"favorite",metric:l=>count(l,"favorites")},
{id:"favorites-5",title:"A Personal Shelf",category:"Your library",description:"Five titles, chosen by you.",icon:"✦",target:5,unit:"favorites",metric:l=>count(l,"favorites")},
{id:"favorites-10",title:"The Collector",category:"Your library",description:"Build a collection of ten favorites.",icon:"◈",target:10,unit:"favorites",metric:l=>count(l,"favorites")},
{id:"favorites-25",title:"Curator in Chief",category:"Your library",description:"Give twenty-five stories a place on your shelf.",icon:"✧",target:25,unit:"favorites",metric:l=>count(l,"favorites")},
{id:"queue-first",title:"One for Later",category:"Watch Later",description:"Save something for a future movie night.",icon:"◷",target:1,unit:"saved title",metric:l=>count(l,"watchLater")},
{id:"queue-5",title:"Future Plans",category:"Watch Later",description:"Line up five possibilities for later.",icon:"⌁",target:5,unit:"saved titles",metric:l=>count(l,"watchLater")},
{id:"queue-10",title:"The Night Planner",category:"Watch Later",description:"Keep ten options ready for the right mood.",icon:"☾",target:10,unit:"saved titles",metric:l=>count(l,"watchLater")},
{id:"history-first",title:"The First Frame",category:"Your journey",description:"Your first title has made it into your history.",icon:"▶",target:1,unit:"logged title",metric:l=>count(l,"history")},
{id:"history-5",title:"The Story Continues",category:"Your journey",description:"Log five titles in your cinema journey.",icon:"▸",target:5,unit:"logged titles",metric:l=>count(l,"history")},
{id:"history-10",title:"A Few Stories In",category:"Your journey",description:"Ten titles are now part of your story.",icon:"▰",target:10,unit:"logged titles",metric:l=>count(l,"history")},
{id:"completion-first",title:"Stay for the Credits",category:"Finished stories",description:"Finish a title and mark the ending.",icon:"✺",target:1,unit:"completed title",metric:l=>finished(l).length},
{id:"completion-5",title:"Credits Roll",category:"Finished stories",description:"Finish five titles in your history.",icon:"✹",target:5,unit:"completed titles",metric:l=>finished(l).length},
{id:"whole-picture",title:"The Whole Picture",category:"Your library",description:"Use Favorites, Watch Later, and History together.",icon:"◉",target:1,unit:"of 3 shelves",metric:l=>["favorites","watchLater","history"].every(k=>count(l,k)>0)?1:0},
{id:"feature-focus",title:"Feature Focus",category:"Your taste",description:"Save five movies to your Favorites.",icon:"▣",target:5,unit:"favorite movies",metric:l=>list(l,"favorites").filter(i=>type(i)==="movie").length},
{id:"series-scout",title:"Series Scout",category:"Your taste",description:"Collect three TV series across your library.",icon:"▤",target:3,unit:"series",metric:l=>unique(all(l).filter(i=>type(i)==="tv")).length},
{id:"library-25",title:"A Library of Your Own",category:"Your library",description:"Collect twenty-five distinct titles across your shelves.",icon:"▥",target:25,unit:"distinct titles",metric:l=>unique(all(l)).length}
];
export function achievementProgress(library){
 return ACHIEVEMENTS.map(a=>{const current=Math.max(0,Number(a.metric(library))||0);return {...a,current,progress:Math.min(current,a.target),percentage:Math.min(100,Math.round(current/a.target*100))}});
}
