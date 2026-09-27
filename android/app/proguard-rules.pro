# Metode yang dipanggil JavaScript lewat addJavascriptInterface harus tetap ada
# dengan nama aslinya.
-keepclassmembers class com.salesmanagement.app.JembatanWeb {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
