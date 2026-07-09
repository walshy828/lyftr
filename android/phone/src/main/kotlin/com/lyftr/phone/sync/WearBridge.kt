package com.lyftr.phone.sync

import android.content.Context
import android.util.Log
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import com.lyftr.shared.WearFields
import com.lyftr.shared.WearPaths
import com.lyftr.shared.WearSession
import kotlinx.coroutines.tasks.await

private const val TAG = "LyftrSync"

/** Publishes the current session to the paired watch over the Data Layer. */
class WearBridge(context: Context) {
    private val dataClient = Wearable.getDataClient(context.applicationContext)

    suspend fun publish(session: WearSession?) {
        val request = PutDataMapRequest.create(WearPaths.SESSION).apply {
            dataMap.putBoolean(WearFields.ACTIVE, session != null)
            dataMap.putString(WearFields.SESSION_JSON, session?.toJson() ?: "")
            dataMap.putLong(WearFields.UPDATED_AT, System.currentTimeMillis())
        }.asPutDataRequest().setUrgent()
        runCatching { dataClient.putDataItem(request).await() }
            .onFailure { Log.e(TAG, "WearBridge.publish failed", it) }
    }
}
