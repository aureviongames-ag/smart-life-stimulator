
const express = require("express");
const path = require("path");
const fs = require("fs");
const webpush = require("web-push");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || "./data";
const FILE = path.join(DATA_DIR, "subscriptions.json");

const LEAGUES = [
 "eng.1","esp.1","uefa.champions",
 "ita.1","ger.1","fra.1"
];

app.use(express.json());
app.use(express.static(__dirname));

function getSubscriptions(){
 try{return JSON.parse(fs.readFileSync(FILE,"utf8"))}
 catch{return []}
}

function saveSubscriptions(data){
 fs.mkdirSync(DATA_DIR,{recursive:true});
 fs.writeFileSync(FILE,JSON.stringify(data,null,2));
}

const ready=Boolean(
 process.env.VAPID_PUBLIC_KEY &&
 process.env.VAPID_PRIVATE_KEY &&
 process.env.VAPID_SUBJECT
);

if(ready){
 webpush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
 );
}

app.get("/api/push/public-key",(req,res)=>{
 if(!ready)return res.status(503).json({error:"Push not configured"});
 res.json({publicKey:process.env.VAPID_PUBLIC_KEY});
});

app.post("/api/push/subscribe",(req,res)=>{
 if(!ready)return res.status(503).json({error:"Push not configured"});

 const sub=req.body;
 if(!sub?.endpoint||!sub.keys?.p256dh||!sub.keys?.auth){
  return res.status(400).json({error:"Invalid subscription"});
 }

 const subscriptions=getSubscriptions().filter(
  x=>x.endpoint!==sub.endpoint
 );

 subscriptions.push(sub);
 saveSubscriptions(subscriptions);

 res.status(201).json({success:true});
});

app.post("/api/push/unsubscribe",(req,res)=>{
 const endpoint=req.body?.endpoint;
 if(typeof endpoint!=="string")return res.status(400).end();

 saveSubscriptions(
  getSubscriptions().filter(x=>x.endpoint!==endpoint)
 );

 res.json({success:true});
});

let previousScores=new Map();
let checking=false;

async function checkScores(){
 if(!ready||checking)return;
 checking=true;

 try{
  const results=await Promise.allSettled(
   LEAGUES.map(async league=>{
    const response=await fetch(
     `https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/scoreboard`
    );

    if(!response.ok)throw Error("Score feed unavailable");

    const data=await response.json();

    return (data.events||[]).map(event=>{
     const teams=event.competitions?.[0]?.competitors||[];
     const home=teams.find(t=>t.homeAway==="home");
     const away=teams.find(t=>t.homeAway==="away");

     if(!home||!away)return null;

     return {
      id:league+":"+event.id,
      home:home.team.displayName,
      away:away.team.displayName,
      score:`${home.score??0}-${away.score??0}`
     };
    }).filter(Boolean);
   })
  );

  const current=new Map();
  const changed=[];

  for(const result of results){
   if(result.status!=="fulfilled")continue;

   for(const match of result.value){
    current.set(match.id,match.score);

    const old=previousScores.get(match.id);

    if(old!==undefined&&old!==match.score){
     changed.push(match);
    }
   }
  }

  // Establish baseline without sending false startup alerts.
  previousScores=current;

  const subscriptions=getSubscriptions();

  for(const match of changed){
   const payload=JSON.stringify({
    title:"⚽ Football Zone Goal Alert",
    body:`${match.home} ${match.score.replace("-"," - ")} ${match.away}`,
    url:"/#fixtures"
   });

   const results=await Promise.allSettled(
    subscriptions.map(sub=>
     webpush.sendNotification(sub,payload,{TTL:3600})
    )
   );

   const dead=[];

   results.forEach((result,index)=>{
    if(result.status==="rejected"&&
       [404,410].includes(result.reason?.statusCode)){
     dead.push(subscriptions[index].endpoint);
    }
   });

   if(dead.length){
    saveSubscriptions(
     getSubscriptions().filter(s=>!dead.includes(s.endpoint))
    );
   }
  }

 }catch(error){
  console.error("Score checking error:",error.message);
 }finally{
  checking=false;
 }
}

if(ready){
 checkScores();
 setInterval(checkScores,60000);
}

app.get("/",(req,res)=>{
 res.sendFile(path.join(__dirname,"index.html"));
});

app.listen(PORT,()=>{
 console.log("Football Zone running on port "+PORT);
});
