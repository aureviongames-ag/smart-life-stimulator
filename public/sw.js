
self.addEventListener("install",event=>{
 self.skipWaiting();
});

self.addEventListener("activate",event=>{
 event.waitUntil(self.clients.claim());
});

self.addEventListener("push",event=>{
 let data={};

 try{
  data=event.data.json();
 }catch(error){}

 event.waitUntil(
  self.registration.showNotification(
   data.title||"Football Zone",
   {
    body:data.body||"Football match update!",
    icon:"/icon-192.png",
    badge:"/icon-192.png",
    data:{url:data.url||"/#fixtures"}
   }
  )
 );
});

self.addEventListener("notificationclick",event=>{
 event.notification.close();

 const url=new URL(
  event.notification.data.url,
  self.location.origin
 ).href;

 event.waitUntil(
  self.clients.openWindow(url)
 );
});
