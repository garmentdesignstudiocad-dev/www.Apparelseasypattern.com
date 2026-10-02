// Express 4 does not forward rejected route promises by itself.
module.exports = function catchRouteErrors(router) {
  for(const layer of router.stack || []) {
    if(layer.route) for(const routeLayer of layer.route.stack) {
      const handler=routeLayer.handle;
      if(handler.length===4) continue;
      routeLayer.handle=function(req,res,next) {
        try { const result=handler(req,res,next);if(result && typeof result.catch==='function') result.catch(next); }
        catch(error) {next(error);}
      };
    } else if(layer.handle?.stack) catchRouteErrors(layer.handle);
  }
};
