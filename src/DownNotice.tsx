import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/** 通知随当前原生dialog进入top layer，保证媒体关闭时文字仍可见、可关闭。 */
export default function DownNotice({name,status,onClose}:{name:string;status:string;onClose:()=>void}){
  const [container,setContainer]=useState<Element>(document.body);
  useEffect(()=>{
    const update=()=>{
      const open=[...document.querySelectorAll("dialog[open]")];
      const host=open.length?open[open.length-1]:document.body;
      setContainer(previous=>previous===host?previous:host);
    };
    update();
    const observer=new MutationObserver(update);
    observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:["open"]});
    return ()=>observer.disconnect();
  },[]);
  return createPortal(<div className="down-notice" role="alert"><strong>下头！</strong><span>{name}点到了你</span><small>{status}</small><button className="tool-button" onClick={onClose}>知道了</button></div>,container);
}
