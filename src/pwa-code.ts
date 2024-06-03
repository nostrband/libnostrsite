export function getPwaCode(ssr: boolean) {
  return `
<script>
  ${ssr ? "" : "window.nostrSite.startPwa();"}
</script>
<style>
  #pwa-toast {
    visibility: hidden;
    position: fixed;
    right: 0;
    bottom: 0;
    margin: 16px;
    padding: 12px;
    border: 1px solid #8885;
    border-radius: 4px;
    z-index: 1;
    text-align: left;
    box-shadow: 3px 4px 5px 0 #8885;
    display: grid;
    background-color: #fff;
  }
  #pwa-toast .message {
    margin-bottom: 8px;
  }
  #pwa-toast .buttons {
    display: flex;
  }
  #pwa-toast button {
    border: 1px solid #8885;
    outline: none;
    margin-right: 5px;
    border-radius: 2px;
    padding: 3px 10px;
  }
  #pwa-toast.show {
    visibility: visible;
  }
  button#pwa-refresh {
    display: none;
  }
  #pwa-toast.show.refresh button#pwa-refresh {
    display: block;
  }  
</style>
`;
}
