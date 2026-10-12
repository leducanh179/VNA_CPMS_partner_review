function rational(value:string){
  if(value.length>60||!/^\d+(\.\d+)?$/.test(value))return{n:0n,d:1n};
  const [whole,fraction='']=value.split('.');return{n:BigInt(whole!+fraction),d:10n**BigInt(fraction.length)};
}
function fixed(value:bigint,scale:number){const text=value.toString().padStart(scale+1,'0');if(!scale)return text;return text.slice(0,-scale)+'.'+text.slice(-scale);}
function rounded(n:bigint,d:bigint){return (n+d/2n)/d;}
/** Match server half-up rounding without floating-point currency artifacts. Invalid drafts preview as zero. */
export function bookingProduct(quantity:string,price:string,basis='1',scale=6){const q=rational(quantity),p=rational(price),b=rational(basis);if(!b.n)return fixed(0n,scale);return fixed(rounded(q.n*p.n*b.d*10n**BigInt(scale),q.d*p.d*b.n),scale);}
export function bookingSum(values:string[],scale=6){return fixed(values.reduce((sum,value)=>{const v=rational(value);return sum+rounded(v.n*10n**BigInt(scale),v.d);},0n),scale);}
