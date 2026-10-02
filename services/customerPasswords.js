const crypto=require('node:crypto'),{promisify}=require('node:util');
const scrypt=promisify(crypto.scrypt);
async function hash(password){const salt=crypto.randomBytes(16).toString('hex');return `scrypt:${salt}:${(await scrypt(password,salt,64,{N:16384,r:8,p:1})).toString('hex')}`;}
async function verify(password,stored){
 const [,salt,key]=/^scrypt:([a-f0-9]{32}):([a-f0-9]{128})$/.exec(stored || '') || [];
 const actual=await scrypt(password,salt || '00000000000000000000000000000000',64,{N:16384,r:8,p:1});
 return Boolean(key && crypto.timingSafeEqual(actual,Buffer.from(key,'hex')));
}
module.exports={hash,verify};
